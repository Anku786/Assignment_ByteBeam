
/* eslint-env worker */

import * as duckdb from '@duckdb/duckdb-wasm';
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { SCHEMA_SQL } from '../db/schema.js';

const DB_PATH = 'opfs://fleet-console-v2.db';
const IDB_NAME = 'fleet-console-fallback-v2';
const IDB_STORE = 'database';
const TABLES = ['vehicles', 'telemetry'];
const INGEST_CHUNK = 1000;

let db = null;
let conn = null;
let mode = null;
let initPromise = null;
let workerBundle = null;

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
    if (!conn) throw new Error('DuckDB is not initialized');
    return toPlain(await conn.query(sql));
}

async function exec(sql) {
    if (!conn) throw new Error('DuckDB is not initialized');
    await conn.query(sql);
}

function sqlString(value) {
    if (value == null) return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
    if (value == null || !Number.isFinite(Number(value))) {
        return 'NULL';
    }

    return String(Number(value));
}

function supportsOPFS() {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.storage?.getDirectory
    );
}

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

    for (const table of TABLES) {
        const file = `snapshot-${table}.parquet`;

        await exec(`COPY ${table} TO '${file}' (FORMAT PARQUET)`);

        try {
            const buffer = await db.copyFileToBuffer(file);
            files[table] = buffer.slice().buffer;
        } finally {
            try {
                await db.dropFile(file);
            } catch {
                // Ignore temporary file cleanup errors.
            }
        }
    }

    const database = await openIDB();

    try {
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                IDB_STORE,
                'readwrite',
            );

            transaction.objectStore(IDB_STORE).put(files, 'database');
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    } finally {
        database.close();
    }
}

async function restoreSnapshot() {
    const database = await openIDB();
    let snapshot;

    try {
        snapshot = await new Promise((resolve, reject) => {
            const transaction = database.transaction(
                IDB_STORE,
                'readonly',
            );

            const request = transaction.objectStore(IDB_STORE).get('database');

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    } finally {
        database.close();
    }

    if (!snapshot) return;

    for (const table of TABLES) {
        if (!snapshot[table]) continue;

        const file = `restore-${table}.parquet`;

        await db.registerFileBuffer(
            file,
            new Uint8Array(snapshot[table]),
        );

        try {
            // Restore only columns present in both the current table
            // and the older snapshot. New columns default to NULL.
            const targetInfo = await query(`PRAGMA table_info('${table}')`);
            const sourceInfo = await query(
                `DESCRIBE SELECT * FROM read_parquet('${file}')`,
            );

            const targetNames = new Set(
                targetInfo.map((column) => column.name),
            );

            const sourceNames = new Set(
                sourceInfo.map((column) => column.column_name),
            );

            const commonColumns = [...targetNames].filter((name) =>
                sourceNames.has(name),
            );

            if (commonColumns.length === 0) continue;

            const columnList = commonColumns
                .map((name) => `"${name.replace(/"/g, '""')}"`)
                .join(', ');

            await exec(`
                INSERT INTO ${table} (${columnList})
                SELECT ${columnList}
                FROM read_parquet('${file}')
            `);
        } finally {
            try {
                await db.dropFile(file);
            } catch {
                // Ignore temporary file cleanup errors.
            }
        }
    }
}

async function persist() {
    if (mode === 'opfs') {
        await exec('CHECKPOINT');
    } else {
        await saveSnapshot();
    }
}

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

    const duckWorker = new Worker(workerBundle.mainWorker);

    const database = new duckdb.AsyncDuckDB(
        new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
        duckWorker,
    );

    await database.instantiate(
        workerBundle.mainModule,
        workerBundle.pthreadWorker,
    );

    return database;
}

/**
 * Migrate existing databases after SCHEMA_SQL has created any missing tables.
 * CREATE TABLE IF NOT EXISTS does not add columns to existing tables.
 */
async function migrateSchema() {
    await exec(`
        ALTER TABLE telemetry
        ADD COLUMN IF NOT EXISTS battery_temp DOUBLE
    `);
}

async function initDatabase() {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        db = await createDatabase();

        if (supportsOPFS()) {
            try {
                await db.open({
                    path: DB_PATH,
                    accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
                });

                conn = await db.connect();
                mode = 'opfs';
            } catch (error) {
                console.warn(
                    'OPFS initialization failed; using IndexedDB fallback.',
                    error,
                );

                try {
                    await db.terminate();
                } catch {
                    // Ignore termination errors.
                }

                db = null;
                conn = null;
            }
        }

        if (!db) {
            db = await createDatabase();
            await db.open({ path: ':memory:' });
            conn = await db.connect();
            mode = 'indexeddb';
        }

        // Create tables first, then migrate older table definitions.
        for (const statement of SCHEMA_SQL) {
            await exec(statement);
        }

        await migrateSchema();

        if (mode === 'indexeddb') {
            const [{ count }] = await query(`
                SELECT COUNT(*)::INTEGER AS count
                FROM vehicles
            `);

            if (count === 0) {
                await restoreSnapshot();
            }
        }

        // Verify the migration and make the actual columns visible in logs.
        const telemetryColumns = await query(
            `PRAGMA table_info('telemetry')`,
        );

        const columnNames = telemetryColumns.map((column) => column.name);

        if (!columnNames.includes('battery_temp')) {
            throw new Error(
                'Schema migration failed: telemetry.battery_temp is missing',
            );
        }

        console.info('[DuckDB] Storage mode:', mode);
        console.info('[DuckDB] Telemetry columns:', columnNames);

        return { mode };
    })().catch((error) => {
        initPromise = null;
        throw error;
    });

    return initPromise;
}

async function upsertVehicles(vehicles = []) {
    for (let i = 0; i < vehicles.length; i += 1) {
        const vehicle = vehicles[i];

        if (!vehicle?.id) continue;

        await exec(`
            INSERT INTO vehicles (id, data, position, updated_at)
            VALUES (
                ${sqlString(vehicle.id)},
                ${sqlString(JSON.stringify(vehicle))}::JSON,
                ${i},
                now()
            )
            ON CONFLICT (id) DO UPDATE SET
                data = EXCLUDED.data,
                position = EXCLUDED.position,
                updated_at = now()
        `);
    }

    if (vehicles.length) await persist();

    return vehicles.length;
}

async function ingestTelemetry(records = []) {
    if (!records.length) {
        return {
            received: 0,
            inserted: 0,
            duplicates: 0,
            invalid: 0,
        };
    }

    let inserted = 0;
    let invalid = 0;

    for (let start = 0; start < records.length; start += INGEST_CHUNK) {
        const chunk = records.slice(start, start + INGEST_CHUNK);
        const receivedAt = Date.now();

        const valid = chunk.filter((packet) => {
            const ok =
                packet?.packetId != null &&
                packet?.packetId !== '' &&
                packet?.vehicleId != null &&
                packet?.vehicleId !== '' &&
                Number.isFinite(Number(packet?.ts));

            if (!ok) invalid += 1;

            return ok;
        });

        if (!valid.length) continue;

        const values = valid.map((packet) => `(
            ${sqlString(packet.packetId)},
            ${sqlString(packet.vehicleId)},
            ${sqlNumber(packet.seq)},
            epoch_ms(${Math.trunc(Number(packet.ts))}),
            epoch_ms(${receivedAt}),
            ${sqlNumber(packet.lat)},
            ${sqlNumber(packet.lng)},
            ${sqlNumber(packet.speed)},
            ${sqlNumber(packet.fuel)},
            ${sqlNumber(packet.battery)},
            ${sqlNumber(packet.batteryTemp ?? packet.battery_temp)},
            ${sqlNumber(packet.engineTemp ?? packet.engine_temp)},
            ${sqlString(JSON.stringify(packet))}::JSON
        )`).join(',');

        const before = await query(`
            SELECT COUNT(*)::INTEGER AS count
            FROM telemetry
        `);

        await exec(`
            INSERT INTO telemetry (
                packet_id,
                vehicle_id,
                seq,
                ts,
                received_at,
                lat,
                lng,
                speed,
                fuel,
                battery,
                battery_temp,
                engine_temp,
                payload
            )
            VALUES ${values}
            ON CONFLICT (packet_id) DO NOTHING
        `);

        const after = await query(`
            SELECT COUNT(*)::INTEGER AS count
            FROM telemetry
        `);

        inserted += after[0].count - before[0].count;
    }

    if (inserted > 0) await persist();

    return {
        received: records.length,
        inserted,
        duplicates: records.length - invalid - inserted,
        invalid,
    };
}

async function listVehicles() {
    return query(`
        WITH latest AS (
            SELECT
                vehicle_id,

                arg_max(lat, ts)
                    FILTER (WHERE lat IS NOT NULL) AS lat,
                arg_max(lng, ts)
                    FILTER (WHERE lng IS NOT NULL) AS lng,
                arg_max(speed, ts)
                    FILTER (WHERE speed IS NOT NULL) AS speed,
                arg_max(fuel, ts)
                    FILTER (WHERE fuel IS NOT NULL) AS fuel,
                arg_max(battery, ts)
                    FILTER (WHERE battery IS NOT NULL) AS battery,
                arg_max(battery_temp, ts)
                    FILTER (WHERE battery_temp IS NOT NULL) AS battery_temp,
                arg_max(engine_temp, ts)
                    FILTER (WHERE engine_temp IS NOT NULL) AS engine_temp,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE lat IS NOT NULL)) AS lat_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE lat IS NOT NULL)) AS lat_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE lng IS NOT NULL)) AS lng_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE lng IS NOT NULL)) AS lng_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE speed IS NOT NULL)) AS speed_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE speed IS NOT NULL)) AS speed_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE fuel IS NOT NULL)) AS fuel_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE fuel IS NOT NULL)) AS fuel_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE battery IS NOT NULL)) AS battery_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE battery IS NOT NULL)) AS battery_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE battery_temp IS NOT NULL)) AS battery_temp_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE battery_temp IS NOT NULL)) AS battery_temp_received_at,

                epoch_ms(arg_max(ts, ts)
                    FILTER (WHERE engine_temp IS NOT NULL)) AS engine_temp_ts,
                epoch_ms(arg_max(received_at, ts)
                    FILTER (WHERE engine_temp IS NOT NULL)) AS engine_temp_received_at,

                epoch_ms(max(ts)) AS telemetry_ts,
                epoch_ms(max(received_at)) AS received_at,
                arg_max(seq, ts) AS latest_seq

            FROM telemetry
            GROUP BY vehicle_id
        )
        SELECT
            v.id,
            v.data->>'name' AS name,
            v.data->>'plate' AS plate,
            v.data->>'driver' AS driver,
            v.data->>'type' AS type,
            v.data,
            v.position,
            l.* EXCLUDE (vehicle_id)
        FROM vehicles v
        LEFT JOIN latest l ON l.vehicle_id = v.id
        ORDER BY v.position, v.id
    `);
}

async function getTelemetryHistory(vehicleId, limit = 20) {
    const safeLimit = Math.max(
        1,
        Math.min(200, Math.trunc(Number(limit) || 20)),
    );

    return query(`
        SELECT
            packet_id AS id,
            vehicle_id AS vehicleId,
            seq,
            epoch_ms(ts) AS ts,
            epoch_ms(received_at) AS receivedAt,
            lat,
            lng,
            speed,
            fuel,
            battery,
            battery_temp AS batteryTemp,
            engine_temp AS engineTemp,

            (
                (lat IS NOT NULL)::INTEGER +
                (lng IS NOT NULL)::INTEGER +
                (speed IS NOT NULL)::INTEGER +
                (fuel IS NOT NULL)::INTEGER +
                (battery IS NOT NULL)::INTEGER +
                (battery_temp IS NOT NULL)::INTEGER +
                (engine_temp IS NOT NULL)::INTEGER
            ) AS signalCount,

            (
                (lat IS NULL)::INTEGER +
                (lng IS NULL)::INTEGER +
                (speed IS NULL)::INTEGER +
                (fuel IS NULL)::INTEGER +
                (battery IS NULL)::INTEGER +
                (battery_temp IS NULL)::INTEGER +
                (engine_temp IS NULL)::INTEGER
            ) > 0 AS isPartial,

            GREATEST(
                0,
                epoch_ms(received_at) - epoch_ms(ts)
            ) AS deliveryDelayMs,

            payload

        FROM telemetry
        WHERE vehicle_id = ${sqlString(vehicleId)}
        ORDER BY ts DESC, received_at DESC
        LIMIT ${safeLimit}
    `);
}

async function refreshTelemetry(records = [], vehicles = []) {
    await upsertVehicles(vehicles);

    await exec('DELETE FROM telemetry');

    await ingestTelemetry(records);

    await persist();

    return {
        refreshed: records.length,
        vehicles: await listVehicles(),
    };
}

const repository = {
    init: initDatabase,
    upsertVehicles,
    ingestTelemetry,
    listVehicles,
    getTelemetryHistory,
    refreshTelemetry,
};

let queue = Promise.resolve();

self.onmessage = ({ data }) => {
    const { id, method, args = [] } = data;

    queue = queue.then(async () => {
        try {
            if (method !== 'init') {
                await initDatabase();
            }

            const fn = repository[method];

            if (typeof fn !== 'function') {
                throw new Error(`Unknown method: ${method}`);
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
                    message: error?.message || String(error),
                },
            });
        }
    });
};
