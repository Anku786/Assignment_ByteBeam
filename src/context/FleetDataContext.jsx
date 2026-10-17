import {
    createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { fleetDb } from '../db/dbClient';

const FleetDataContext = createContext(null);

// Liveness is measured from the time a packet was COMMITTED locally (received_at).
export const ONLINE_MS = 30_000;
export const STALE_MS = 120_000;

export const FleetDataProvider = ({ children }) => {
    const [dbRows, setDbRows] = useState([]);
    const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'error'
    const [error, setError] = useState(null);
    const [storage, setStorage] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    const refresh = useCallback(async () => {
        const [vehicles, info] = await Promise.all([
            fleetDb.listVehicles(),
            fleetDb.getStorageInfo(),
        ]);
        setDbRows(vehicles);
        setStorage(info);
    }, []);

    // Coalesce bursts of writes into at most one query in flight + one queued.
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
                if (!cancelled) setStatus('ready');
            } catch (e) {
                if (!cancelled) {
                    setError(e);
                    setStatus('error');
                }
            }
        })();
        const unsubscribe = fleetDb.subscribe(() => {
            requestRefresh().catch(setError);
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [refresh, requestRefresh]);

    // Re-evaluate online/stale/offline without hitting the database.
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 5000);
        return () => clearInterval(id);
    }, []);

    const rows = useMemo(
        () =>
            dbRows.map((r) => {
                const seen = r.latest?.lastReceived;
                const connection =
                    seen == null ? 'never'
                        : now - seen <= ONLINE_MS ? 'online'
                            : now - seen <= STALE_MS ? 'stale'
                                : 'offline';
                return { ...r, connection };
            }),
        [dbRows, now]
    );

    const value = useMemo(
        () => ({
            rows,   // each row: vehicle fields + latest {speed, fuel, battery, ..., signalTs} + connection
            status,
            error,
            storage,
            ingestTelemetry: fleetDb.ingestTelemetry,
            upsertVehicles: fleetDb.upsertVehicles,
            getTelemetryHistory: fleetDb.getTelemetryHistory,
            getIngestionStats: fleetDb.getIngestionStats,
            resetData: fleetDb.reset,
        }),
        [rows, status, error, storage]
    );

    return <FleetDataContext.Provider value={value}>{children}</FleetDataContext.Provider>;
};

export function useFleetData() {
    const value = useContext(FleetDataContext);
    if (!value) throw new Error('useFleetData must be used within FleetDataProvider');
    return value;
}