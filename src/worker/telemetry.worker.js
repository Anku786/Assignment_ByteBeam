/* eslint-env worker */
// Dedicated worker that owns DuckDB-Wasm (OPFS persistence, IndexedDB-snapshot fallback).
import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { SCHEMA_SQL, TABLES, SIGNALS } from '../db/schema.js';

const DB_PATH = 'opfs://fleet-console.db';
const IDB_NAME = 'fleet-console-fallback';
const IDB_STORE = 'snapshots';
const INGEST_CHUNK = 5000;

let db = null;
let conn = null;
let mode = 'uninitialized'; // 'opfs' | 'indexeddb-snapshot'
let initPromise = null;
let persistedByBrowser = false;
let fileSeq = 0;

// ---------- helpers ----------

function supportsOpfs() {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.storage?.getDirectory &&
        typeof FileSystemFileHandle !== 'undefined' &&
        'createSyncAccessHandle' in FileSystemFileHandle.prototype
    );
}

const plain = (x) =>
    JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

async function all(sql, params = []) {
    let result;
    if (params.length) {
        const stmt = await conn.prepare(sql);
        try {
            result = await stmt.query(...params);
        } finally {
            await stmt.close();
        }
    } else {
        result = await conn.query(sql);
    }
    return plain(result.toArray().map((r) => r.toJSON()));
}

async function exec(sql) {
    await conn.query(sql);
}

async function withJsonFile(rows, fn) {
    const name = `batch-${++fileSeq}.json`;
    await db.registerFileText(name, JSON.stringify(rows));
    try {
        return await fn(name);
    } finally {
        await db.dropFile(name);
    }
}

// ---------- IndexedDB snapshot fallback ----------

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbReadAll() {
    const d = await idb();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const out = {};
        let pending = TABLES.length;
        TABLES.forEach((t) => {
            const r = store.get(t);
            r.onsuccess = () => {
                out[t] = r.result || null;
                if (--pending === 0) resolve(out);
            };
            r.onerror = () => reject(r.error);
        });
    });
}

async function idbWriteAll(buffers) {
    const d = await idb();
    return new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        Object.entries(buffers).forEach(([k, v]) => store.put(v, k));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function restoreFromSnapshot() {
    const snap = await idbReadAll();
    for (const t of TABLES) {
        if (!snap[t]) continue;
        const file = `restore-${t}.parquet`;
        await db.registerFileBuffer(file, new Uint8Array(snap[t]));
        await exec(`INSERT INTO ${t} SELECT * FROM read_parquet('${file}')`);
        await db.dropFile(file);
    }
}

async function writeSnapshot() {
    const buffers = {};
    for (const t of TABLES) {
        const file = `snap-${t}.parquet`;
        await exec(`COPY ${t} TO '${file}' (FORMAT PARQUET)`);
        buffers[t] = (await db.copyFileToBuffer(file)).slice().buffer;
        await db.dropFile(file);
    }
    await idbWriteAll(buffers);
}

async function flush() {
    if (mode === 'opfs') await exec('CHECKPOINT');
    else await writeSnapshot();
}

// ---------- boot ----------

async function boot() {
    const bundle = await duckdb.selectBundle({
        mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
        eh: { mainModule: ehWasm, mainWorker: ehWorker },
    });
    const inner = new Worker(bundle.mainWorker);
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), inner);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

    try {
        persistedByBrowser = (await navigator.storage?.persist?.()) ?? false;
    } catch {
        persistedByBrowser = false;
    }

    if (supportsOpfs()) {
        try {
            await db.open({ path: DB_PATH, accessMode: duckdb.DuckDBAccessMode.READ_WRITE });
            mode = 'opfs';
        } catch (e) {
            const msg = String(e?.message || e);
            if (/lock|access handle|NoModificationAllowed|in use/i.test(msg)) {
                const err = new Error(
                    'The fleet database is open in another tab. Close the other tab and reload.'
                );
                err.code = 'DB_LOCKED';
                throw err;
            }
            console.warn('OPFS open failed, falling back to IndexedDB snapshots:', e);
        }
    }

    if (mode !== 'opfs') {
        await db.open({ path: ':memory:' });
        mode = 'indexeddb-snapshot';
    }

    conn = await db.connect();
    for (const sql of SCHEMA_SQL) await exec(sql);

    if (mode === 'indexeddb-snapshot') {
        const [{ n }] = await all('SELECT count(*)::INTEGER AS n FROM vehicles');
        if (n === 0) await restoreFromSnapshot();
    }
}

const ready = () => (initPromise ??= boot());

// ---------- packet normalisation & identity ----------

const parseMs = (t) => {
    if (t == null || t === '') return null;
    if (typeof t === 'number') return Number.isFinite(t) ? Math.round(t) : null;
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? null : ms;
};
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const KNOWN = new Set([
    'packetId', 'vehicleId', 'seq', 'ts', 'lat', 'lng', 'speed', 'fuel', 'battery', 'engineTemp',
]);

// 53-bit string hash, used only for the identity fallback.
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const canonical = (r) =>
    JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));

// Identity priority: explicit packetId > vehicleId:seq > content hash.
function packetIdOf(r, tsMs) {
    if (r.packetId != null && r.packetId !== '') return String(r.packetId);
    if (r.seq != null) return `${r.vehicleId}:${Math.trunc(Number(r.seq))}`;
    return `${r.vehicleId}@${tsMs}#${cyrb53(canonical(r)).toString(36)}`;
}

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// ---------- repository ----------

const repo = {
    async init() {
        await ready();
        return { mode };
    },

    async getMeta(key) {
        const r = await all('SELECT value FROM meta WHERE key = ?', [String(key)]);
        return r[0]?.value ?? null;
    },

    async setMeta(key, value) {
        await all('INSERT OR REPLACE INTO meta VALUES (?, ?)', [String(key), String(value)]);
        await flush();
        return true;
    },

    // Insert/refresh vehicle details (name, plate, driver...). Order = array order.
    async upsertVehicles(vehicles) {
        if (!vehicles?.length) return { upserted: 0 };
        const rows = vehicles.map((v, i) => ({
            id: String(v.id ?? i), // change v.id if your vehicle key differs
            data: JSON.stringify(v),
            position: i,
        }));
        await withJsonFile(rows, (file) =>
            exec(`INSERT INTO vehicles (id, data, position)
            SELECT id, data::JSON, position
            FROM read_json('${file}', format = 'array',
                           columns = {id: 'VARCHAR', data: 'VARCHAR', position: 'INTEGER'})
            ON CONFLICT (id) DO UPDATE
              SET data = excluded.data,
                  position = excluded.position,
                  updated_at = now()`)
        );
        await flush();
        return { upserted: rows.length };
    },

    // Latest NON-NULL value per signal (by event time), plus per-signal timestamps.
    async listVehicles() {
        const signalSql = SIGNALS.map(
            (s) =>
                `arg_max(t.${s}, t.ts) FILTER (WHERE t.${s} IS NOT NULL) AS ${s},
         epoch_ms(max(t.ts) FILTER (WHERE t.${s} IS NOT NULL))::DOUBLE AS ${s}_ts`
        ).join(',\n');
        const rows = await all(`
      SELECT any_value(v.data)::VARCHAR AS data,
             count(t.packet_id)::DOUBLE AS packets,
             epoch_ms(max(t.ts))::DOUBLE AS data_ts,
             epoch_ms(max(t.received_at))::DOUBLE AS last_received,
             ${signalSql}
      FROM vehicles v
      LEFT JOIN telemetry t ON t.vehicle_id = v.id
      GROUP BY v.id, v.position
      ORDER BY v.position NULLS LAST, v.id`);
        return rows.map((r) => {
            const base = JSON.parse(r.data);
            if (!r.packets) return { ...base, latest: null };
            const latest = {
                packets: r.packets,
                dataTs: r.data_ts,               // newest event time seen
                lastReceived: r.last_received,   // newest commit time (liveness)
                signalTs: {},
            };
            for (const s of SIGNALS) {
                latest[camel(s)] = r[s];
                latest.signalTs[camel(s)] = r[`${s}_ts`];
            }
            return { ...base, latest };
        });
    },

    // records: [{ packetId?, vehicleId, seq?, ts, lat?, lng?, speed?, fuel?, battery?, engineTemp?, ...extra }]
    async ingestTelemetry(records) {
        if (!records?.length) return { received: 0, inserted: 0, duplicates: 0, rejected: 0 };
        const recvMs = Date.now();
        const rows = [];
        let rejected = 0;

        for (const r of records) {
            const tsMs = r ? parseMs(r.ts) : null;
            if (!r || r.vehicleId == null || r.vehicleId === '' || tsMs == null) {
                rejected++;
                continue;
            }
            const extra = {};
            for (const k of Object.keys(r)) if (!KNOWN.has(k)) extra[k] = r[k];
            rows.push({
                packet_id: packetIdOf(r, tsMs),
                vehicle_id: String(r.vehicleId),
                seq: r.seq == null ? null : Math.trunc(Number(r.seq)),
                ts_ms: tsMs,
                recv_ms: recvMs,
                lat: num(r.lat),
                lng: num(r.lng),
                speed: num(r.speed),
                fuel: num(r.fuel),
                battery: num(r.battery),
                engine_temp: num(r.engineTemp),
                payload: Object.keys(extra).length ? JSON.stringify(extra) : null,
            });
        }
        if (!rows.length) return { received: records.length, inserted: 0, duplicates: 0, rejected };

        const [{ n: before }] = await all('SELECT count(*)::DOUBLE AS n FROM telemetry');

        for (let i = 0; i < rows.length; i += INGEST_CHUNK) {
            const chunk = rows.slice(i, i + INGEST_CHUNK);
            await withJsonFile(chunk, async (file) => {
                const src = `read_json('${file}', format = 'array', columns = {
          packet_id: 'VARCHAR', vehicle_id: 'VARCHAR', seq: 'BIGINT',
          ts_ms: 'BIGINT', recv_ms: 'BIGINT',
          lat: 'DOUBLE', lng: 'DOUBLE', speed: 'DOUBLE', fuel: 'DOUBLE',
          battery: 'DOUBLE', engine_temp: 'DOUBLE', payload: 'VARCHAR'
        })`;
                // Unknown vehicles get a minimal row so they appear in the fleet.
                await exec(`INSERT INTO vehicles (id, data)
                    SELECT DISTINCT vehicle_id, json_object('id', vehicle_id)
                    FROM ${src}
                    WHERE vehicle_id NOT IN (SELECT id FROM vehicles)`);
                // Dedup: once inside the batch (QUALIFY), once against stored rows (ON CONFLICT).
                await exec(`INSERT INTO telemetry
                      (packet_id, vehicle_id, seq, ts, received_at,
                       lat, lng, speed, fuel, battery, engine_temp, payload)
                    SELECT packet_id, vehicle_id, seq, epoch_ms(ts_ms), epoch_ms(recv_ms),
                           lat, lng, speed, fuel, battery, engine_temp, payload::JSON
                    FROM ${src}
                    QUALIFY row_number() OVER (PARTITION BY packet_id ORDER BY ts_ms) = 1
                    ON CONFLICT DO NOTHING`);
            });
        }

        const [{ n: after }] = await all('SELECT count(*)::DOUBLE AS n FROM telemetry');
        const inserted = after - before;
        if (inserted > 0) await flush();
        return {
            received: records.length,
            inserted,
            duplicates: rows.length - inserted,
            rejected,
        };
    },

    async getTelemetryHistory({ vehicleId, limit = 500 }) {
        return all(
            `SELECT packet_id AS "packetId", seq::DOUBLE AS seq,
              epoch_ms(ts)::DOUBLE AS ts, epoch_ms(received_at)::DOUBLE AS "receivedAt",
              lat, lng, speed, fuel, battery, engine_temp AS "engineTemp"
       FROM telemetry WHERE vehicle_id = ? ORDER BY ts DESC LIMIT ?`,
            [String(vehicleId), Number(limit)]
        );
    },

    // Integrity view: packets vs distinct ids (must match) and missing sequence numbers.
    async getIngestionStats() {
        const [totals] = await all(
            `SELECT count(*)::DOUBLE AS packets, count(DISTINCT packet_id)::DOUBLE AS distinct_ids
       FROM telemetry`
        );
        const perVehicle = await all(
            `SELECT vehicle_id AS "vehicleId",
              count(*)::DOUBLE AS packets,
              count(seq)::DOUBLE AS "withSeq",
              min(seq)::DOUBLE AS "minSeq",
              max(seq)::DOUBLE AS "maxSeq",
              (max(seq) - min(seq) + 1 - count(seq))::DOUBLE AS missing,
              epoch_ms(max(received_at))::DOUBLE AS "lastReceived"
       FROM telemetry GROUP BY vehicle_id ORDER BY vehicle_id`
        );
        return { packets: totals.packets, distinctIds: totals.distinct_ids, perVehicle };
    },

    async getStorageInfo() {
        let quota = null;
        try {
            const est = await navigator.storage?.estimate?.();
            if (est) quota = { usage: est.usage ?? null, quota: est.quota ?? null };
        } catch {
            /* ignore */
        }
        const [{ n }] = await all('SELECT count(*)::DOUBLE AS n FROM telemetry');
        return { mode, persistedByBrowser, telemetryRows: n, ...quota };
    },

    async reset() {
        await exec('DELETE FROM telemetry');
        await exec('DELETE FROM vehicles');
        await exec('DELETE FROM meta');
        await flush();
    },
};

// ---------- RPC (serialized) ----------
let queue = Promise.resolve();

self.onmessage = (e) => {
    const { id, method, args = [] } = e.data;
    queue = queue.then(async () => {
        try {
            if (method !== 'init') await ready();
            const result = await repo[method](...args);
            self.postMessage({ id, ok: true, result });
        } catch (err) {
            self.postMessage({
                id,
                ok: false,
                error: { message: String(err?.message || err), code: err?.code },
            });
        }
    });
};