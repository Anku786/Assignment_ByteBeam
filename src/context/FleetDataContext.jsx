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

// Liveness is measured from locally committed received_at.
export const ONLINE_MS = 30_000;
export const STALE_MS = 120_000;

function evaluateFreshness(receivedAt, now) {
    if (receivedAt == null) {
        return {
            state: 'never',
            ageMs: null,
            label: 'No data',
        };
    }

    const ageMs = Math.max(0, now - Number(receivedAt));

    if (ageMs <= ONLINE_MS) {
        return {
            state: 'fresh',
            ageMs,
            label: 'Fresh',
        };
    }

    if (ageMs <= STALE_MS) {
        return {
            state: 'stale',
            ageMs,
            label: 'Stale',
        };
    }

    return {
        state: 'offline',
        ageMs,
        label: 'Offline',
    };
}

function getAlerts(row) {
    const alerts = [];

    const battery = Number(row.battery);
    const fuel = Number(row.fuel);
    const engineTemp = Number(row.engine_temp ?? row.engineTemp);

    /*
     * Connection / freshness
     */
    if (row.connection === 'offline') {
        alerts.push({
            id: `${row.id}-offline`,
            vehicleId: row.id,
            level: 'crit',
            text: 'Offline',
        });
    } else if (
        row.connection === 'stale' ||
        row.connection === 'never'
    ) {
        alerts.push({
            id: `${row.id}-stale`,
            vehicleId: row.id,
            level: 'warn',
            text: row.connection === 'never'
                ? 'No telemetry'
                : 'Stale data',
        });
    }

    /*
     * Battery
     */
    if (Number.isFinite(battery)) {
        if (battery < 10) {
            alerts.push({
                id: `${row.id}-battery-critical`,
                vehicleId: row.id,
                level: 'crit',
                text: 'Critical battery',
            });
        } else if (battery < 20) {
            alerts.push({
                id: `${row.id}-battery-low`,
                vehicleId: row.id,
                level: 'warn',
                text: 'Low battery',
            });
        }
    }

    /*
     * Fuel
     * EVs do not use fuel.
     */
    if (row.type !== 'EV' && Number.isFinite(fuel)) {
        if (fuel < 5) {
            alerts.push({
                id: `${row.id}-fuel-critical`,
                vehicleId: row.id,
                level: 'crit',
                text: 'Critical fuel',
            });
        } else if (fuel < 20) {
            alerts.push({
                id: `${row.id}-fuel-low`,
                vehicleId: row.id,
                level: 'warn',
                text: 'Low fuel',
            });
        }
    }

    /*
     * Engine temperature
     */
    if (Number.isFinite(engineTemp)) {
        if (engineTemp >= 110) {
            alerts.push({
                id: `${row.id}-temperature-critical`,
                vehicleId: row.id,
                level: 'crit',
                text: 'Engine temperature critical',
            });
        } else if (engineTemp >= 100) {
            alerts.push({
                id: `${row.id}-temperature-high`,
                vehicleId: row.id,
                level: 'warn',
                text: 'High engine temperature',
            });
        }
    }

    return alerts;
}

function deriveVehicleStatus(row) {
    if (row.connection === 'offline' || row.connection === 'never') {
        return 'offline';
    }

    if (row.alerts.some((alert) => alert.level === 'crit')) {
        return 'critical';
    }

    if (row.alerts.length > 0) {
        return 'attention';
    }

    if (Number(row.speed) > 0) {
        return 'moving';
    }

    return 'idle';
}

function buildRows(dbRows, now) {
    return dbRows.map((row) => {
        /*
         * Your listVehicles() result currently exposes received_at.
         * Keep compatibility with a nested latest object too.
         */
        const receivedAt =
            row.received_at ??
            row.latest?.received_at ??
            row.latest?.lastReceived ??
            null;

        const freshness = evaluateFreshness(receivedAt, now);

        const connection =
            freshness.state === 'fresh'
                ? 'online'
                : freshness.state === 'stale'
                    ? 'stale'
                    : freshness.state === 'offline'
                        ? 'offline'
                        : 'never';

        /*
         * Keep latest telemetry in the same shape expected by the UI.
         */
        const latest = row.latest ?? {
            vehicleId: row.id,
            speed: row.speed,
            fuel: row.fuel,
            battery: row.battery,
            engineTemp: row.engine_temp ?? row.engineTemp,
            lat: row.lat,
            lng: row.lng,
            ts: row.telemetry_ts,
            receivedAt,
        };

        /*
         * Odometer:
         * use the DB value when it exists.
         * Otherwise fall back to vehicle metadata.
         */
        const odometer =
            row.odometer ??
            latest.odometer ??
            (() => {
                try {
                    const data =
                        typeof row.data === 'string'
                            ? JSON.parse(row.data)
                            : row.data;

                    return data?.odometer ?? null;
                } catch {
                    return null;
                }
            })();

        const baseRow = {
            ...row,
            latest,
            received_at: receivedAt,
            freshness,
            connection,
            odometer,
        };

        const alerts = getAlerts(baseRow);

        const openAlerts = alerts.map((alert) => ({
            ...alert,
            status: 'open',
        }));

        return {
            ...baseRow,
            alerts,
            openAlerts,
            status: deriveVehicleStatus({
                ...baseRow,
                alerts,
            }),
        };
    });
}

export const FleetDataProvider = ({ children }) => {
    const [dbRows, setDbRows] = useState([]);
    const [status, setStatus] = useState('initializing');
    const [error, setError] = useState(null);
    const [storage, setStorage] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    const refresh = useCallback(async () => {
        const vehicles = await fleetDb.listVehicles();

        setDbRows(vehicles);

        // listVehicles() is currently the DB data source.
        // Do not assign its result to storage.
    }, []);

    /*
     * Coalesce bursts of writes into at most one query in flight
     * plus one queued refresh.
     */
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

                if (cancelled) return;

                await refresh();

                if (!cancelled) {
                    setStatus('ready');
                }
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

    /*
     * Recalculate freshness without querying DuckDB.
     */
    useEffect(() => {
        const id = setInterval(() => {
            setNow(Date.now());
        }, 5_000);

        return () => clearInterval(id);
    }, []);

    /*
     * Build the complete UI row from DuckDB data.
     */
    const rows = useMemo(
        () => buildRows(dbRows, now),
        [dbRows, now],
    );

    /*
     * Flatten all row alerts.
     */
    const attention = useMemo(
        () =>
            rows.flatMap((row) =>
                row.openAlerts.map((alert) => ({
                    ...alert,
                    vehicleId: row.id,
                    vehicleName: row.name,
                })),
            ),
        [rows],
    );

    const openAttention = useMemo(
        () => attention.filter((item) => item.status === 'open'),
        [attention],
    );

    const value = useMemo(
        () => ({
            /*
             * Main UI source.
             */
            rows,

            /*
             * DB-backed data.
             */
            vehicles: rows,
            latest: rows.map((row) => row.latest).filter(Boolean),

            /*
             * Derived freshness.
             */
            freshness: Object.fromEntries(
                rows.map((row) => [row.id, row.freshness]),
            ),

            /*
             * Derived alerts / attention.
             */
            attention,
            openAttention,

            /*
             * DB state.
             */
            status,
            error,
            storage,

            /*
             * DB operations.
             */
            ingestTelemetry: fleetDb.ingestTelemetry,
            upsertVehicles: fleetDb.upsertVehicles,
            getTelemetryHistory: fleetDb.getTelemetryHistory,
            getIngestionStats: fleetDb.getIngestionStats,
            resetData: fleetDb.reset,
            refreshTelemetry: fleetDb.refreshTelemetry,
            refreshLocal: refresh,
        }),
        [
            rows,
            attention,
            openAttention,
            status,
            error,
            storage,
            refresh,
        ],
    );

    return (
        <FleetDataContext.Provider value={value}>
            {children}
        </FleetDataContext.Provider>
    );
};

export function useFleetData() {
    const value = useContext(FleetDataContext);

    if (!value) {
        throw new Error(
            'useFleetData must be used within FleetDataProvider',
        );
    }

    return value;
}