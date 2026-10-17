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

    listVehicles: () => call('listVehicles'),

    async seedVehicles(vehicles) {
        const res = await call('seedVehicles', vehicles);
        notify();
        return res;
    },

    async ingestTelemetry(records) {
        const res = await call('ingestTelemetry', records);

        if (res.inserted > 0) {
            notify();
        }

        return res;
    },

    async refreshTelemetry(records) {
        const res = await call('refreshTelemetry', records);
        notify();
        return res;
    },

    async upsertVehicles(vehicles) {
        const res = await call('upsertVehicles', vehicles);
        notify();
        return res;
    },

    async clearData() {
        const res = await call('clearData');
        notify();
        return res;
    },

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