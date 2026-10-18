import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { fleetDb } from '../db/dbClient';

const FleetDataContext = createContext(null);

export const ONLINE_MS = 30_000;
export const STALE_MS = 120_000;

function evaluateFreshness(receivedAt, now) {
    if (receivedAt == null) {
        return { state: 'never', ageMs: null, label: 'No data' };
    }

    const ageMs = Math.max(0, now - Number(receivedAt));
    if (ageMs <= ONLINE_MS) return { state: 'fresh', ageMs, label: 'Fresh' };
    if (ageMs <= STALE_MS) return { state: 'stale', ageMs, label: 'Stale' };
    return { state: 'offline', ageMs, label: 'Offline' };
}

function isFresh(signalState) {
    return signalState?.state === 'fresh';
}


function getAlerts(row) {
    const alerts = [];

    const hasValue = (value) =>
        value !== null &&
        value !== undefined &&
        value !== '' &&
        Number.isFinite(Number(value));

    const battery = hasValue(row.battery) ? Number(row.battery) : null;
    const batteryTemp = hasValue(row.battery_temp)
        ? Number(row.battery_temp)
        : null;
    const engineTemp = hasValue(row.engine_temp)
        ? Number(row.engine_temp)
        : null;

    const batteryFresh = isFresh(row.signalFreshness?.battery);
    const batteryTempFresh = isFresh(row.signalFreshness?.batteryTemp);
    const engineTempFresh = isFresh(row.signalFreshness?.engineTemp);

    // Battery alerts
    if (batteryFresh && battery !== null) {
        if (battery < 10) {
            alerts.push({
                id: `${row.id}-battery-soc`,
                vehicleId: row.id,
                level: 'crit',
                severity: 'critical',
                title: 'Critical battery',
                message: `Battery SOC is ${battery}%.`,
                text: `Critical battery (${battery}%)`,
            });
        } else if (battery < 20) {
            alerts.push({
                id: `${row.id}-battery-soc`,
                vehicleId: row.id,
                level: 'warn',
                severity: 'warning',
                title: 'Low battery',
                message: `Battery SOC is ${battery}%.`,
                text: `Low battery (${battery}%)`,
            });
        }
    }

    // Battery temperature alerts
    if (batteryTempFresh && batteryTemp !== null) {
        if (batteryTemp > 45) {
            alerts.push({
                id: `${row.id}-battery-temperature`,
                vehicleId: row.id,
                level: 'crit',
                severity: 'critical',
                title: 'Battery overheating',
                message: `Battery temperature is ${batteryTemp}°C.`,
                text: `Battery temperature high (${batteryTemp}°C)`,
            });
        } else if (batteryTemp > 40) {
            alerts.push({
                id: `${row.id}-battery-temperature`,
                vehicleId: row.id,
                level: 'warn',
                severity: 'warning',
                title: 'High battery temperature',
                message: `Battery temperature is ${batteryTemp}°C.`,
                text: `Battery temperature elevated (${batteryTemp}°C)`,
            });
        }
    }

    // Engine temperature alerts
    if (engineTempFresh && engineTemp !== null) {
        if (engineTemp > 110) {
            alerts.push({
                id: `${row.id}-engine-temperature`,
                vehicleId: row.id,
                level: 'crit',
                severity: 'critical',
                title: 'Engine overheating',
                message: `Engine temperature is ${engineTemp}°C.`,
                text: `Engine temperature high (${engineTemp}°C)`,
            });
        } else if (engineTemp > 100) {
            alerts.push({
                id: `${row.id}-engine-temperature`,
                vehicleId: row.id,
                level: 'warn',
                severity: 'warning',
                title: 'High engine temperature',
                message: `Engine temperature is ${engineTemp}°C.`,
                text: `Engine temperature elevated (${engineTemp}°C)`,
            });
        }
    }

    // Connection alert: only for vehicles that have previously sent telemetry.
    if (row.hasTelemetry && row.connection === 'offline') {
        alerts.push({
            id: `${row.id}-connection`,
            vehicleId: row.id,
            level: 'warn',
            severity: 'warning',
            title: 'Vehicle offline',
            message: `No recent telemetry received for ${row.name ?? row.id}.`,
            text: 'Vehicle connection is offline',
        });
    }

    return alerts;
}


function deriveVehicleStatus(row) {
    const batteryFresh = isFresh(row.signalFreshness?.battery);
    const speedFresh = isFresh(row.signalFreshness?.speed);

    if (!row.hasTelemetry) return 'offline';
    if (row.connection === 'offline') return 'offline';
    if (row.alerts.some((alert) => alert.level === 'crit')) return 'critical';
    if (row.alerts.length) return 'attention';
    if (!batteryFresh || !speedFresh) return 'uncertain';
    if (Number(row.speed) > 0) return 'moving';
    return 'idle';
}

function buildRows(dbRows, now) {
    return dbRows.map((row) => {
        const signalFreshness = signalFreshnessForRow(row, now);
        const receivedAt = row.received_at ?? null;
        const overallFreshness = evaluateFreshness(receivedAt, now);
        const hasTelemetry = row.telemetry_ts != null;

        const connection = !hasTelemetry
            ? 'never'
            : overallFreshness.state === 'fresh'
                ? 'online'
                : overallFreshness.state === 'stale'
                    ? 'stale'
                    : 'offline';

        const latest = {
            vehicleId: row.id,
            seq: row.latest_seq,
            speed: row.speed,
            fuel: row.fuel,
            battery: row.battery,
            batteryTemp: row.battery_temp,
            engineTemp: row.engine_temp,
            lat: row.lat,
            lng: row.lng,
            ts: row.telemetry_ts,
            receivedAt,
        };

        const data = (() => {
            try {
                return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            } catch {
                return {};
            }
        })();
        const odometer = data?.odometer ?? null;
        const speedFresh = isFresh(signalFreshness.speed);
        const ignition = speedFresh && Number(row.speed) > 0 ? 'On' : speedFresh ? 'Off' : 'Unknown';

        const baseRow = {
            ...row,
            data,
            latest,
            received_at: receivedAt,
            freshness: overallFreshness,
            signalFreshness,
            connection,
            hasTelemetry,
            odometer,
            ignition,
        };

        const alerts = getAlerts(baseRow);
        const openAlerts = alerts.map((alert) => ({ ...alert, status: 'open' }));

        return {
            ...baseRow,
            alerts,
            openAlerts,
            status: deriveVehicleStatus({ ...baseRow, alerts }),
        };
    });
}

function signalFreshnessForRow(row, now) {
    const eventTimes = {
        lat: row.lat_ts,
        lng: row.lng_ts,
        speed: row.speed_ts,
        fuel: row.fuel_ts,
        battery: row.battery_ts,
        batteryTemp: row.battery_temp_ts,
        engineTemp: row.engine_temp_ts,
    };

    return Object.fromEntries(
        Object.entries(eventTimes).map(([signal, value]) => [
            signal,
            evaluateFreshness(value, now),
        ]),
    );
}

export const FleetDataProvider = ({ children }) => {
    const [dbRows, setDbRows] = useState([]);
    const [status, setStatus] = useState('initializing');
    const [error, setError] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    const refresh = useCallback(async () => {
        setDbRows(await fleetDb.listVehicles());
    }, []);

    const inFlight = useRef(false);
    const dirty = useRef(false);

    const requestRefresh = useCallback(async () => {
        if (inFlight.current) {
            dirty.current = true;
            return;
        }

        inFlight.current = true;
        try {
            do {
                dirty.current = false;
                await refresh();
            } while (dirty.current);
        } finally {
            inFlight.current = false;
        }
    }, [refresh]);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                await fleetDb.init();
                await refresh();
                if (!cancelled) setStatus('ready');
            } catch (e) {
                if (!cancelled) {
                    setError(e);
                    setStatus('error');
                }
            }
        })();

        const unsubscribe = fleetDb.subscribe(() => {
            requestRefresh().catch((e) => {
                setError(e);
                setStatus('error');
            });
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [refresh, requestRefresh]);

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 5_000);
        return () => clearInterval(id);
    }, []);

    const rows = useMemo(() => buildRows(dbRows, now), [dbRows, now]);

    const attention = useMemo(
        () => rows.flatMap((row) => row.openAlerts.map((alert) => ({
            ...alert,
            vehicleId: row.id,
            vehicleName: row.name,
        }))),
        [rows],
    );

    const value = useMemo(() => ({
        rows,
        vehicles: rows,
        latest: rows.map((row) => row.latest).filter(Boolean),
        freshness: Object.fromEntries(rows.map((row) => [row.id, row.freshness])),
        attention,
        openAttention: attention,
        status,
        error,
        ingestTelemetry: fleetDb.ingestTelemetry,
        upsertVehicles: fleetDb.upsertVehicles,
        getTelemetryHistory: fleetDb.getTelemetryHistory,
        refreshTelemetry: fleetDb.refreshTelemetry,
        refreshLocal: refresh,
    }), [rows, attention, status, error, refresh]);

    return (
        <FleetDataContext.Provider value={value}>
            {children}
        </FleetDataContext.Provider>
    );
};

export function useFleetData() {
    const value = useContext(FleetDataContext);
    if (!value) throw new Error('useFleetData must be used within FleetDataProvider');
    return value;
}
