/* eslint-env worker */

import * as duckdb from '@duckdb/duckdb-wasm';

import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const DB_PATH = 'opfs://fleet-console.db';

const IDB_NAME = 'fleet-console-fallback';
const IDB_STORE = 'database';

const INGEST_CHUNK = 5000;

let db = null;
let conn = null;
let mode = null;
let initPromise = null;

let workerBundle = null;


// ---------------------------------------------------------
// Utilities
// ---------------------------------------------------------

function toPlain(rows) {
    return rows.toArray().map((row) => {
        const value = row.toJSON();

        for (const key of Object.keys(value)) {
            if (typeof value[key] === 'bigint') {
                value[key] = Number(value[key]);
            }
        }

        return value;
    });
}


async function query(sql) {
    if (!conn) {
        throw new Error('DuckDB is not initialized');
    }

    const result = await conn.query(sql);

    return toPlain(result);
}


async function exec(sql) {
    if (!conn) {
        throw new Error('DuckDB is not initialized');
    }

    await conn.query(sql);
}


function supportsOPFS() {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.storage?.getDirectory
    );
}


// ---------------------------------------------------------
// IndexedDB fallback
// ---------------------------------------------------------

function openIDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, 1);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(IDB_STORE)) {
                database.createObjectStore(IDB_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


async function saveSnapshot() {
    const files = {};

    for (const table of ['vehicles', 'telemetry']) {
        const file = `snapshot-${table}.parquet`;

        await exec(`
            COPY ${table}
            TO '${file}'
            (FORMAT PARQUET)
        `);

        try {
            const buffer = await db.copyFileToBuffer(file);

            files[table] = buffer.slice().buffer;
        } finally {
            try {
                await db.dropFile(file);
            } catch {
                // Ignore cleanup errors.
            }
        }
    }

    const database = await openIDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(
            IDB_STORE,
            'readwrite'
        );

        const store = transaction.objectStore(IDB_STORE);

        store.put(files, 'database');

        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
    });
}


async function restoreSnapshot() {
    const database = await openIDB();

    const snapshot = await new Promise((resolve, reject) => {
        const transaction = database.transaction(
            IDB_STORE,
            'readonly'
        );

        const request = transaction
            .objectStore(IDB_STORE)
            .get('database');

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    if (!snapshot) {
        return;
    }

    for (const table of ['vehicles', 'telemetry']) {
        if (!snapshot[table]) {
            continue;
        }

        const file = `restore-${table}.parquet`;

        await db.registerFileBuffer(
            file,
            new Uint8Array(snapshot[table])
        );

        try {
            await exec(`
                INSERT INTO ${table}
                SELECT *
                FROM read_parquet('${file}')
            `);
        } finally {
            try {
                await db.dropFile(file);
            } catch {
                // Ignore cleanup errors.
            }
        }
    }
}


// ---------------------------------------------------------
// Persistence
// ---------------------------------------------------------

async function persist() {
    if (mode === 'opfs') {
        await exec('CHECKPOINT');
    } else {
        await saveSnapshot();
    }
}


// ---------------------------------------------------------
// DuckDB
// ---------------------------------------------------------

async function createDatabase() {
    workerBundle ??= await duckdb.selectBundle({
        mvp: {
            mainModule: mvpWasm,
            mainWorker: mvpWorker,
        },

        eh: {
            mainModule: ehWasm,
            mainWorker: ehWorker,
        },
    });

    const duckWorker = new Worker(
        workerBundle.mainWorker
    );

    const database = new duckdb.AsyncDuckDB(
        new duckdb.ConsoleLogger(
            duckdb.LogLevel.WARNING
        ),
        duckWorker
    );

    await database.instantiate(
        workerBundle.mainModule,
        workerBundle.pthreadWorker
    );

    return database;
}


// ---------------------------------------------------------
// Database initialization
// ---------------------------------------------------------

async function initDatabase() {
    if (initPromise) {
        return initPromise;
    }

    initPromise = (async () => {
        db = await createDatabase();

        // ---------------------------------------------
        // Preferred: OPFS
        // ---------------------------------------------

        if (supportsOPFS()) {
            try {
                await db.open({
                    path: DB_PATH,
                    accessMode:
                        duckdb.DuckDBAccessMode.READ_WRITE,
                });

                conn = await db.connect();

                mode = 'opfs';
            } catch (error) {
                console.warn(
                    '[DB] OPFS unavailable, using IndexedDB fallback',
                    error
                );

                try {
                    await db.terminate();
                } catch {
                    // Ignore.
                }

                db = null;
                conn = null;
            }
        }

        // ---------------------------------------------
        // Fallback: in-memory DuckDB + IndexedDB
        // ---------------------------------------------

        if (!db) {
            db = await createDatabase();

            await db.open({
                path: ':memory:',
            });

            conn = await db.connect();

            mode = 'indexeddb';
        }

        // ---------------------------------------------
        // Schema
        // ---------------------------------------------

        await exec(`
            CREATE TABLE IF NOT EXISTS vehicles (
                id VARCHAR PRIMARY KEY,
                name VARCHAR,
                vin VARCHAR,
                make VARCHAR,
                model VARCHAR,
                region VARCHAR,
                city VARCHAR,
                lat DOUBLE,
                lng DOUBLE
            )
        `);

        await exec(`
            CREATE TABLE IF NOT EXISTS telemetry (
                packet_id VARCHAR PRIMARY KEY,
                vehicle_id VARCHAR NOT NULL,
                ts TIMESTAMP NOT NULL,
                received_at TIMESTAMP NOT NULL,

                lat DOUBLE,
                lng DOUBLE,
                speed DOUBLE,
                fuel DOUBLE,
                battery DOUBLE,
                engine_temp DOUBLE
            )
        `);

        // Restore only for fallback mode.
        if (mode === 'indexeddb') {
            const [{ count }] = await query(`
                SELECT COUNT(*)::INTEGER AS count
                FROM vehicles
            `);

            if (count === 0) {
                await restoreSnapshot();
            }
        }

        return {
            mode,
        };
    })();

    return initPromise;
}


// ---------------------------------------------------------
// Vehicle seeding
// ---------------------------------------------------------

async function seedVehicles(vehicles = []) {
    if (!vehicles.length) {
        return {
            inserted: 0,
        };
    }

    for (
        let start = 0;
        start < vehicles.length;
        start += INGEST_CHUNK
    ) {
        const chunk = vehicles.slice(
            start,
            start + INGEST_CHUNK
        );

        const values = chunk
            .map((vehicle) => {
                const quote = (value) =>
                    `'${String(value ?? '')
                        .replaceAll("'", "''")}'`;

                return `(
                    ${quote(vehicle.id)},
                    ${quote(vehicle.name)},
                    ${quote(vehicle.vin)},
                    ${quote(vehicle.make)},
                    ${quote(vehicle.model)},
                    ${quote(vehicle.region)},
                    ${quote(vehicle.city)},
                    ${Number(vehicle.lat ?? 0)},
                    ${Number(vehicle.lng ?? 0)}
                )`;
            })
            .join(',');

        await exec(`
            INSERT INTO vehicles (
                id,
                name,
                vin,
                make,
                model,
                region,
                city,
                lat,
                lng
            )
            VALUES ${values}

            ON CONFLICT (id)
            DO NOTHING
        `);
    }

    await persist();

    return {
        inserted: vehicles.length,
    };
}


// ---------------------------------------------------------
// Telemetry ingestion
// ---------------------------------------------------------

async function ingestTelemetry(records = []) {
    if (!records.length) {
        return {
            received: 0,
            inserted: 0,
        };
    }

    const receivedAt = Date.now();

    let inserted = 0;

    for (
        let start = 0;
        start < records.length;
        start += INGEST_CHUNK
    ) {
        const chunk = records.slice(
            start,
            start + INGEST_CHUNK
        );

        const values = chunk
            .filter(
                (packet) =>
                    packet?.packetId &&
                    packet?.vehicleId &&
                    packet?.ts
            )
            .map((packet) => {
                const quote = (value) =>
                    `'${String(value)
                        .replaceAll("'", "''")}'`;

                return `(
                    ${quote(packet.packetId)},
                    ${quote(packet.vehicleId)},
                    epoch_ms(${Number(packet.ts)}),
                    epoch_ms(${receivedAt}),
                    ${Number(packet.lat ?? 0)},
                    ${Number(packet.lng ?? 0)},
                    ${Number(packet.speed ?? 0)},
                    ${Number(packet.fuel ?? 0)},
                    ${Number(packet.battery ?? 0)},
                    ${Number(packet.engineTemp ?? 0)}
                )`;
            })
            .join(',');

        if (!values) {
            continue;
        }

        const before = await query(`
            SELECT COUNT(*)::INTEGER AS count
            FROM telemetry
        `);

        await exec(`
            INSERT INTO telemetry (
                packet_id,
                vehicle_id,
                ts,
                received_at,
                lat,
                lng,
                speed,
                fuel,
                battery,
                engine_temp
            )
            VALUES ${values}

            ON CONFLICT (packet_id)
            DO NOTHING
        `);

        const after = await query(`
            SELECT COUNT(*)::INTEGER AS count
            FROM telemetry
        `);

        inserted +=
            after[0].count - before[0].count;
    }

    if (inserted > 0) {
        await persist();
    }

    return {
        received: records.length,
        inserted,
        duplicates:
            records.length - inserted,
    };
}


// ---------------------------------------------------------
// Latest fleet state
// ---------------------------------------------------------

async function listVehicles() {
    const rows = await query(`
        SELECT
            v.id,
            v.data,
            v.position,

            arg_max(t.lat, t.ts)
                FILTER (WHERE t.lat IS NOT NULL) AS lat,

            arg_max(t.lng, t.ts)
                FILTER (WHERE t.lng IS NOT NULL) AS lng,

            arg_max(t.speed, t.ts)
                FILTER (WHERE t.speed IS NOT NULL) AS speed,

            arg_max(t.fuel, t.ts)
                FILTER (WHERE t.fuel IS NOT NULL) AS fuel,

            arg_max(t.battery, t.ts)
                FILTER (WHERE t.battery IS NOT NULL) AS battery,

            arg_max(t.engine_temp, t.ts)
                FILTER (WHERE t.engine_temp IS NOT NULL) AS engine_temp,

            MAX(t.ts) AS telemetry_ts,
            MAX(t.received_at) AS received_at

        FROM vehicles v

        LEFT JOIN telemetry t
            ON t.vehicle_id = v.id

        GROUP BY
            v.id,
            v.data,
            v.position

        ORDER BY v.id
    `);

    return rows;
}


// ---------------------------------------------------------
// Repository
// ---------------------------------------------------------

const repository = {
    init: initDatabase,
    seedVehicles,
    ingestTelemetry,
    listVehicles,
};


// ---------------------------------------------------------
// RPC
// ---------------------------------------------------------

let queue = Promise.resolve();

self.onmessage = (event) => {
    const {
        id,
        method,
        args = [],
    } = event.data;

    queue = queue.then(async () => {
        try {
            if (method !== 'init') {
                await initDatabase();
            }

            const fn = repository[method];

            if (typeof fn !== 'function') {
                throw new Error(
                    `Unknown method: ${method}`
                );
            }

            const result = await fn(...args);

            self.postMessage({
                id,
                ok: true,
                result,
            });
        } catch (error) {
            self.postMessage({
                id,
                ok: false,
                error: {
                    message:
                        error?.message ||
                        String(error),
                },
            });
        }
    });
};