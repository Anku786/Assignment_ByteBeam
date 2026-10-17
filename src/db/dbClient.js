// Main-thread facade over the DuckDB worker. No DuckDB code runs on the UI thread.
let worker = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();

function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('../worker/telemetry.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
        const p = pending.get(data.id);
        if (!p) return;
        pending.delete(data.id);
        if (data.ok) p.resolve(data.result);
        else {
            const err = new Error(data.error.message);
            err.code = data.error.code;
            p.reject(err);
        }
    };
    worker.onerror = (e) => {
        const err = new Error(e.message || 'Database worker crashed');
        pending.forEach((p) => p.reject(err));
        pending.clear();
    };
    return worker;
}

function call(method, ...args) {
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        getWorker().postMessage({ id, method, args });
    });
}

const notify = () => listeners.forEach((fn) => fn());

export const fleetDb = {
    init: () => call('init'),
    query: (sql) => call('query', sql),
    getMeta: (key) => call('getMeta', key),
    setMeta: (key, value) => call('setMeta', key, value),
    listVehicles: () => call('listVehicles'),
    getTelemetryHistory: (opts) => call('getTelemetryHistory', opts),
    getIngestionStats: () => call('getIngestionStats'),
    getStorageInfo: () => call('getStorageInfo'),

    async upsertVehicles(vehicles) {
        const res = await call('upsertVehicles', vehicles);
        notify();
        return res;
    },

    // Resolves AFTER the packets are committed and durable.
    // Returns { received, inserted, duplicates, rejected }.
    async ingestTelemetry(records) {
        console.log('[DB] ingestTelemetry called', {
            count: records?.length,
            first: records?.[0],
        });
        const res = await call('ingestTelemetry', records);
        if (res.inserted > 0) notify(); // pure duplicates change nothing, so no refresh
        return res;
    },

    async reset() {
        await call('reset');
        notify();
    },

    // Fires after a write is committed so views can re-query the database.
    subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    },
};

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        worker?.terminate();
        worker = null;
        pending.clear();
    });
}