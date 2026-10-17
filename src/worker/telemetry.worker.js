/* eslint-env worker */

// Dedicated worker that owns DuckDB-Wasm.
// Primary persistence: OPFS
// Fallback persistence: IndexedDB snapshots
//
// IMPORTANT:
// - Use a DuckDB-Wasm version with working OPFS persistence.
// - Recommended stable version: @duckdb/duckdb-wasm@1.32.0
// - OPFS database path must remain exactly `opfs://fleet-console.db`.
// - CHECKPOINT is used after durable writes.

import * as duckdb from '@duckdb/duckdb-wasm';

import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

import { SCHEMA_SQL, TABLES, SIGNALS } from '../db/schema.js';


// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const DB_PATH = 'opfs://fleet-console.db';

const IDB_NAME = 'fleet-console-fallback';
const IDB_STORE = 'snapshots';

const INGEST_CHUNK = 5000;


// -----------------------------------------------------------------------------
// Runtime state
// -----------------------------------------------------------------------------

let db = null;
let conn = null;

let mode = 'uninitialized';
// 'opfs' | 'indexeddb-snapshot'

let initPromise = null;

let persistedByBrowser = false;

let fileSeq = 0;

let bundle = null;


// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function supportsOpfs() {
    return (
        typeof navigator !== 'undefined' &&
        !!navigator.storage?.getDirectory &&
        typeof FileSystemFileHandle !== 'undefined' &&
        'createSyncAccessHandle' in FileSystemFileHandle.prototype
    );
}


const plain = (value) =>
    JSON.parse(
        JSON.stringify(value, (_key, v) =>
            typeof v === 'bigint' ? Number(v) : v
        )
    );


async function all(sql, params = []) {
    if (!conn) {
        throw new Error('DuckDB connection is not initialized');
    }

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

    return plain(
        result
            .toArray()
            .map((row) => row.toJSON())
    );
}


async function exec(sql) {
    if (!conn) {
        throw new Error('DuckDB connection is not initialized');
    }

    await conn.query(sql);
}


async function withJsonFile(rows, fn) {
    if (!db) {
        throw new Error('DuckDB instance is not initialized');
    }

    const name = `batch-${++fileSeq}.json`;

    await db.registerFileText(
        name,
        JSON.stringify(rows)
    );

    try {
        return await fn(name);
    } finally {
        try {
            await db.dropFile(name);
        } catch {
            // Ignore cleanup errors.
        }
    }
}


// -----------------------------------------------------------------------------
// IndexedDB snapshot fallback
// -----------------------------------------------------------------------------

function idb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);

        req.onupgradeneeded = () => {
            const database = req.result;

            if (!database.objectStoreNames.contains(IDB_STORE)) {
                database.createObjectStore(IDB_STORE);
            }
        };

        req.onsuccess = () => {
            resolve(req.result);
        };

        req.onerror = () => {
            reject(req.error);
        };
    });
}


async function idbReadAll() {
    const database = await idb();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(
            IDB_STORE,
            'readonly'
        );

        const store = tx.objectStore(IDB_STORE);

        const out = {};

        let pending = TABLES.length;

        if (pending === 0) {
            resolve(out);
            return;
        }

        TABLES.forEach((table) => {
            const request = store.get(table);

            request.onsuccess = () => {
                out[table] = request.result || null;

                pending -= 1;

                if (pending === 0) {
                    resolve(out);
                }
            };

            request.onerror = () => {
                reject(request.error);
            };
        });

        tx.onabort = () => {
            reject(tx.error);
        };
    });
}


async function idbWriteAll(buffers) {
    const database = await idb();

    return new Promise((resolve, reject) => {
        const tx = database.transaction(
            IDB_STORE,
            'readwrite'
        );

        const store = tx.objectStore(IDB_STORE);

        Object.entries(buffers).forEach(([key, value]) => {
            store.put(value, key);
        });

        tx.oncomplete = () => {
            resolve();
        };

        tx.onerror = () => {
            reject(tx.error);
        };

        tx.onabort = () => {
            reject(tx.error);
        };
    });
}


async function restoreFromSnapshot() {
    const snapshot = await idbReadAll();

    for (const table of TABLES) {
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


async function writeSnapshot() {
    const buffers = {};

    for (const table of TABLES) {
        const file = `snap-${table}.parquet`;

        await exec(`
            COPY ${table}
            TO '${file}'
            (FORMAT PARQUET)
        `);

        try {
            buffers[table] = (
                await db.copyFileToBuffer(file)
            ).slice().buffer;
        } finally {
            try {
                await db.dropFile(file);
            } catch {
                // Ignore cleanup errors.
            }
        }
    }

    await idbWriteAll(buffers);
}


// -----------------------------------------------------------------------------
// OPFS diagnostics
// -----------------------------------------------------------------------------

async function debugOPFS() {
    if (!supportsOpfs()) {
        console.warn('[DB] OPFS is not supported');
        return;
    }

    try {
        const root =
            await navigator.storage.getDirectory();

        console.log('[DB] OPFS contents:');

        for await (const [name, handle] of root.entries()) {
            console.log(
                '[DB] OPFS entry:',
                name,
                handle.kind
            );
        }
    } catch (error) {
        console.warn(
            '[DB] Could not inspect OPFS:',
            error
        );
    }
}


// -----------------------------------------------------------------------------
// Durability
// -----------------------------------------------------------------------------

async function flush() {
    if (mode === 'opfs') {
        // DuckDB's documented mechanism for persisting
        // committed changes to OPFS.
        await exec('CHECKPOINT');

        console.log('[DB] CHECKPOINT complete');

        // Do not use db.flushFiles() as the persistence mechanism.
        // CHECKPOINT is the important operation.
    } else if (mode === 'indexeddb-snapshot') {
        await writeSnapshot();

        console.log('[DB] IndexedDB snapshot complete');
    }
}


// -----------------------------------------------------------------------------
// Browser persistence
// -----------------------------------------------------------------------------

async function requestBrowserPersistence() {
    try {
        persistedByBrowser =
            (await navigator.storage?.persist?.()) ?? false;
    } catch {
        persistedByBrowser = false;
    }
}


// -----------------------------------------------------------------------------
// One database owner per tab
// -----------------------------------------------------------------------------

function acquireTabLock() {
    if (!navigator.locks) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        navigator.locks.request(
            'fleet-console-db',
            { ifAvailable: true },
            (lock) => {
                if (!lock) {
                    resolve(false);
                    return undefined;
                }

                resolve(true);

                // Hold lock for worker lifetime.
                return new Promise(() => { });
            }
        );
    });
}


// -----------------------------------------------------------------------------
// DuckDB creation
// -----------------------------------------------------------------------------

async function createDb() {
    bundle ??=
        await duckdb.selectBundle({
            mvp: {
                mainModule: mvpWasm,
                mainWorker: mvpWorker,
            },

            eh: {
                mainModule: ehWasm,
                mainWorker: ehWorker,
            },
        });

    const innerWorker =
        new Worker(bundle.mainWorker);

    const instance =
        new duckdb.AsyncDuckDB(
            new duckdb.ConsoleLogger(
                duckdb.LogLevel.WARNING
            ),
            innerWorker
        );

    await instance.instantiate(
        bundle.mainModule,
        bundle.pthreadWorker
    );

    return instance;
}


// -----------------------------------------------------------------------------
// Database boot
// -----------------------------------------------------------------------------

async function boot() {
    // Only one worker/tab may own the persistent database.
    if (!(await acquireTabLock())) {
        const error = new Error(
            'The fleet database is already open in another tab or window. Close it and reload.'
        );

        error.code = 'DB_LOCKED';

        throw error;
    }

    await requestBrowserPersistence();

    db = await createDb();


    // -------------------------------------------------------------------------
    // Primary path: OPFS
    // -------------------------------------------------------------------------

    if (supportsOpfs()) {
        try {
            console.log(
                '[DB] Opening persistent DuckDB:',
                DB_PATH
            );

            await db.open({
                path: DB_PATH,
                accessMode:
                    duckdb.DuckDBAccessMode.READ_WRITE,
            });

            console.log(
                '[DB] DuckDB opened successfully:',
                DB_PATH
            );

            mode = 'opfs';

            // IMPORTANT:
            // Connect only AFTER db.open().
            conn = await db.connect();

            console.log(
                '[DB] DuckDB connection established'
            );

            // -----------------------------------------------------------------
            // Verify the database immediately.
            // -----------------------------------------------------------------

            const [{ objects }] = await all(`
                SELECT count(*)::INTEGER AS objects
                FROM information_schema.tables
            `);

            console.log(
                '[DB] tables after open:',
                objects
            );

            // Diagnostic only. It does NOT determine the storage mode.
            await debugOPFS();

        } catch (error) {
            console.error(
                '[DB] OPFS open failed:',
                error
            );

            mode = 'uninitialized';

            // If an OPFS connection was partially created,
            // terminate it before starting fallback.
            try {
                if (db) {
                    await db.terminate();
                }
            } catch {
                // Ignore.
            }

            db = null;
            conn = null;
        }
    }


    // -------------------------------------------------------------------------
    // Fallback: IndexedDB snapshots
    // -------------------------------------------------------------------------

    if (mode !== 'opfs') {
        console.warn(
            '[fleetDb] Falling back to IndexedDB snapshots'
        );

        db = await createDb();

        await db.open({
            path: ':memory:',
        });

        mode = 'indexeddb-snapshot';

        conn = await db.connect();

        console.log(
            '[DB] IndexedDB fallback database initialized'
        );
    }


    // -------------------------------------------------------------------------
    // Schema
    // -------------------------------------------------------------------------

    for (const sql of SCHEMA_SQL) {
        await exec(sql);
    }


    // -------------------------------------------------------------------------
    // Restore fallback snapshot if necessary
    // -------------------------------------------------------------------------

    if (mode === 'indexeddb-snapshot') {
        const [{ n }] = await all(`
            SELECT count(*)::INTEGER AS n
            FROM vehicles
        `);

        if (n === 0) {
            console.log(
                '[DB] Attempting IndexedDB snapshot restore'
            );

            await restoreFromSnapshot();
        }
    }


    // -------------------------------------------------------------------------
    // Final diagnostics
    // -------------------------------------------------------------------------

    const [vehicleCount] = await all(`
        SELECT count(*)::INTEGER AS n
        FROM vehicles
    `);

    const [telemetryCount] = await all(`
        SELECT count(*)::INTEGER AS n
        FROM telemetry
    `);

    console.log(
        '[DB] BOOT COMPLETE',
        {
            mode,
            vehicles: vehicleCount.n,
            telemetry: telemetryCount.n,
            persistedByBrowser,
        }
    );

    return {
        mode,
    };
}


const ready = () =>
    (initPromise ??= boot());


// -----------------------------------------------------------------------------
// Packet normalisation & identity
// -----------------------------------------------------------------------------

const parseMs = (value) => {
    if (value == null || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value)
            ? Math.round(value)
            : null;
    }

    const ms = Date.parse(value);

    return Number.isNaN(ms)
        ? null
        : ms;
};


const num = (value) => {
    if (
        value == null ||
        value === '' ||
        Number.isNaN(Number(value))
    ) {
        return null;
    }

    return Number(value);
};


const KNOWN = new Set([
    'packetId',
    'vehicleId',
    'seq',
    'ts',
    'lat',
    'lng',
    'speed',
    'fuel',
    'battery',
    'engineTemp',
]);


// 53-bit string hash.
// Used only for packet identity fallback.
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;

    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);

        h1 = Math.imul(
            h1 ^ ch,
            2654435761
        );

        h2 = Math.imul(
            h2 ^ ch,
            1597334677
        );
    }

    h1 =
        Math.imul(
            h1 ^ (h1 >>> 16),
            2246822507
        ) ^
        Math.imul(
            h2 ^ (h2 >>> 13),
            3266489909
        );

    h2 =
        Math.imul(
            h2 ^ (h2 >>> 16),
            2246822507
        ) ^
        Math.imul(
            h1 ^ (h1 >>> 13),
            3266489909
        );

    return (
        4294967296 * (2097151 & h2) +
        (h1 >>> 0)
    );
}


const canonical = (record) =>
    JSON.stringify(
        Object.keys(record)
            .sort()
            .map((key) => [
                key,
                record[key],
            ])
    );


// Identity priority:
// 1. explicit packetId
// 2. vehicleId:seq
// 3. content hash
function packetIdOf(record, tsMs) {
    if (
        record.packetId != null &&
        record.packetId !== ''
    ) {
        return String(record.packetId);
    }

    if (record.seq != null) {
        return `${record.vehicleId}:${Math.trunc(
            Number(record.seq)
        )}`;
    }

    return `${record.vehicleId}@${tsMs}#${cyrb53(
        canonical(record)
    ).toString(36)}`;
}


const camel = (value) =>
    value.replace(
        /_([a-z])/g,
        (_, character) =>
            character.toUpperCase()
    );


// -----------------------------------------------------------------------------
// Repository
// -----------------------------------------------------------------------------

const repo = {

    async init() {
        await ready();

        return {
            mode,
        };
    },


    // Temporary/direct SQL diagnostic API.
    async query(sql) {
        await ready();

        return all(sql);
    },


    async getMeta(key) {
        const rows = await all(
            `
            SELECT value
            FROM meta
            WHERE key = ?
            `,
            [String(key)]
        );

        return rows[0]?.value ?? null;
    },


    async setMeta(key, value) {
        await all(
            `
            INSERT OR REPLACE INTO meta
            VALUES (?, ?)
            `,
            [
                String(key),
                String(value),
            ]
        );

        await flush();

        return true;
    },


    // -------------------------------------------------------------------------
    // Vehicles
    // -------------------------------------------------------------------------

    async upsertVehicles(vehicles) {
        if (!vehicles?.length) {
            return {
                upserted: 0,
            };
        }

        const rows = vehicles.map(
            (vehicle, index) => ({
                id: String(
                    vehicle.id ?? index
                ),

                data: JSON.stringify(vehicle),

                position: index,
            })
        );


        await withJsonFile(
            rows,
            (file) =>
                exec(`
                    INSERT INTO vehicles
                        (id, data, position)

                    SELECT
                        id,
                        data::JSON,
                        position

                    FROM read_json(
                        '${file}',
                        format = 'array',
                        columns = {
                            id: 'VARCHAR',
                            data: 'VARCHAR',
                            position: 'INTEGER'
                        }
                    )

                    ON CONFLICT (id)
                    DO UPDATE SET
                        data = excluded.data,
                        position = excluded.position,
                        updated_at = now()
                `)
        );


        await flush();

        return {
            upserted: rows.length,
        };
    },


    // -------------------------------------------------------------------------
    // Fleet rows
    // -------------------------------------------------------------------------

    async listVehicles() {
        const signalSql =
            SIGNALS.map(
                (signal) =>
                    `
                    arg_max(
                        t.${signal},
                        t.ts
                    )
                    FILTER (
                        WHERE t.${signal} IS NOT NULL
                    ) AS ${signal},

                    epoch_ms(
                        max(t.ts)
                        FILTER (
                            WHERE t.${signal} IS NOT NULL
                        )
                    )::DOUBLE AS ${signal}_ts
                    `
            ).join(',\n');


        const rows = await all(`
            SELECT
                any_value(v.data)::VARCHAR AS data,

                count(t.packet_id)::DOUBLE AS packets,

                epoch_ms(
                    max(t.ts)
                )::DOUBLE AS data_ts,

                epoch_ms(
                    max(t.received_at)
                )::DOUBLE AS last_received,

                ${signalSql}

            FROM vehicles v

            LEFT JOIN telemetry t
                ON t.vehicle_id = v.id

            GROUP BY
                v.id,
                v.position

            ORDER BY
                v.position NULLS LAST,
                v.id
        `);


        return rows.map((row) => {
            const base = JSON.parse(row.data);

            if (!row.packets) {
                return {
                    ...base,
                    latest: null,
                };
            }


            const latest = {
                packets: row.packets,

                // Newest event timestamp.
                dataTs: row.data_ts,

                // Newest browser receive/commit timestamp.
                lastReceived: row.last_received,

                signalTs: {},
            };


            for (const signal of SIGNALS) {
                const camelName =
                    camel(signal);

                latest[camelName] =
                    row[signal];

                latest.signalTs[camelName] =
                    row[`${signal}_ts`];
            }


            return {
                ...base,
                latest,
            };
        });
    },


    // -------------------------------------------------------------------------
    // Telemetry ingestion
    // -------------------------------------------------------------------------

    async ingestTelemetry(records) {
        if (!records?.length) {
            return {
                received: 0,
                inserted: 0,
                duplicates: 0,
                rejected: 0,
            };
        }


        const recvMs = Date.now();

        const rows = [];

        let rejected = 0;


        for (const record of records) {
            const tsMs =
                record
                    ? parseMs(record.ts)
                    : null;


            if (
                !record ||
                record.vehicleId == null ||
                record.vehicleId === '' ||
                tsMs == null
            ) {
                console.warn(
                    '[DB] REJECTED telemetry record',
                    {
                        record,
                        vehicleId:
                            record?.vehicleId,
                        ts:
                            record?.ts,
                        parsedTs:
                            tsMs,
                    }
                );

                rejected += 1;

                continue;
            }


            const extra = {};

            for (const key of Object.keys(record)) {
                if (!KNOWN.has(key)) {
                    extra[key] = record[key];
                }
            }


            rows.push({
                packet_id:
                    packetIdOf(
                        record,
                        tsMs
                    ),

                vehicle_id:
                    String(record.vehicleId),

                seq:
                    record.seq == null
                        ? null
                        : Math.trunc(
                            Number(record.seq)
                        ),

                ts_ms: tsMs,

                recv_ms: recvMs,

                lat: num(record.lat),

                lng: num(record.lng),

                speed: num(record.speed),

                fuel: num(record.fuel),

                battery:
                    num(record.battery),

                engine_temp:
                    num(record.engineTemp),

                payload:
                    Object.keys(extra).length
                        ? JSON.stringify(extra)
                        : null,
            });
        }


        if (!rows.length) {
            return {
                received: records.length,
                inserted: 0,
                duplicates: 0,
                rejected,
            };
        }


        console.log(
            '[DB] normalized rows',
            {
                count: rows.length,
                first: rows[0],
            }
        );


        const [
            { n: before },
        ] = await all(`
            SELECT count(*)::DOUBLE AS n
            FROM telemetry
        `);


        console.log(
            '[DB] telemetry BEFORE insert:',
            before
        );


        // ---------------------------------------------------------------------
        // Insert chunks
        // ---------------------------------------------------------------------

        for (
            let i = 0;
            i < rows.length;
            i += INGEST_CHUNK
        ) {
            const chunk =
                rows.slice(
                    i,
                    i + INGEST_CHUNK
                );


            await withJsonFile(
                chunk,
                async (file) => {
                    const src = `
                        read_json(
                            '${file}',
                            format = 'array',
                            columns = {
                                packet_id: 'VARCHAR',
                                vehicle_id: 'VARCHAR',
                                seq: 'BIGINT',
                                ts_ms: 'BIGINT',
                                recv_ms: 'BIGINT',
                                lat: 'DOUBLE',
                                lng: 'DOUBLE',
                                speed: 'DOUBLE',
                                fuel: 'DOUBLE',
                                battery: 'DOUBLE',
                                engine_temp: 'DOUBLE',
                                payload: 'VARCHAR'
                            }
                        )
                    `;


                    // Unknown vehicles get a minimal fleet row.
                    await exec(`
                        INSERT INTO vehicles
                            (id, data)

                        SELECT DISTINCT
                            vehicle_id,
                            json_object(
                                'id',
                                vehicle_id
                            )

                        FROM ${src}

                        WHERE vehicle_id NOT IN (
                            SELECT id
                            FROM vehicles
                        )
                    `);


                    // Deduplication:
                    // - row_number() handles duplicates inside this batch
                    // - ON CONFLICT handles duplicates already stored
                    await exec(`
                        INSERT INTO telemetry
                            (
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
                                engine_temp,
                                payload
                            )

                        SELECT
                            packet_id,
                            vehicle_id,
                            seq,
                            epoch_ms(ts_ms),
                            epoch_ms(recv_ms),
                            lat,
                            lng,
                            speed,
                            fuel,
                            battery,
                            engine_temp,
                            payload::JSON

                        FROM ${src}

                        QUALIFY row_number()
                            OVER (
                                PARTITION BY packet_id
                                ORDER BY ts_ms
                            ) = 1

                        ON CONFLICT DO NOTHING
                    `);
                }
            );
        }


        const [
            { n: after },
        ] = await all(`
            SELECT count(*)::DOUBLE AS n
            FROM telemetry
        `);


        console.log(
            '[DB] telemetry AFTER insert:',
            after
        );


        const inserted =
            after - before;


        // ---------------------------------------------------------------------
        // Durable commit
        // ---------------------------------------------------------------------

        if (inserted > 0) {
            console.log(
                '[DB] flushing DuckDB',
                {
                    inserted,
                    mode,
                }
            );

            await flush();

            console.log(
                '[DB] flush complete'
            );
        }


        return {
            received: records.length,

            inserted,

            duplicates:
                rows.length - inserted,

            rejected,
        };
    },


    // -------------------------------------------------------------------------
    // Telemetry history
    // -------------------------------------------------------------------------

    async getTelemetryHistory({
        vehicleId,
        limit = 500,
    }) {
        return all(
            `
            SELECT
                packet_id AS "packetId",

                seq::DOUBLE AS seq,

                epoch_ms(ts)::DOUBLE AS ts,

                epoch_ms(
                    received_at
                )::DOUBLE AS "receivedAt",

                lat,
                lng,
                speed,
                fuel,
                battery,

                engine_temp AS "engineTemp"

            FROM telemetry

            WHERE vehicle_id = ?

            ORDER BY ts DESC

            LIMIT ?
            `,
            [
                String(vehicleId),
                Number(limit),
            ]
        );
    },


    // -------------------------------------------------------------------------
    // Ingestion integrity
    // -------------------------------------------------------------------------

    async getIngestionStats() {
        const [
            totals,
        ] = await all(`
            SELECT
                count(*)::DOUBLE AS packets,

                count(
                    DISTINCT packet_id
                )::DOUBLE AS distinct_ids

            FROM telemetry
        `);


        const perVehicle =
            await all(`
                SELECT
                    vehicle_id AS "vehicleId",

                    count(*)::DOUBLE AS packets,

                    count(seq)::DOUBLE AS "withSeq",

                    min(seq)::DOUBLE AS "minSeq",

                    max(seq)::DOUBLE AS "maxSeq",

                    (
                        max(seq)
                        - min(seq)
                        + 1
                        - count(seq)
                    )::DOUBLE AS missing,

                    epoch_ms(
                        max(received_at)
                    )::DOUBLE AS "lastReceived"

                FROM telemetry

                GROUP BY vehicle_id

                ORDER BY vehicle_id
            `);


        return {
            packets:
                totals.packets,

            distinctIds:
                totals.distinct_ids,

            perVehicle,
        };
    },


    // -------------------------------------------------------------------------
    // Storage information
    // -------------------------------------------------------------------------

    async getStorageInfo() {
        let quota = null;


        try {
            const estimate =
                await navigator
                    .storage
                    ?.estimate
                    ?.();

            if (estimate) {
                quota = {
                    usage:
                        estimate.usage ??
                        null,

                    quota:
                        estimate.quota ??
                        null,
                };
            }
        } catch {
            // Ignore.
        }


        const [
            { n },
        ] = await all(`
            SELECT count(*)::DOUBLE AS n
            FROM telemetry
        `);


        return {
            mode,

            persistedByBrowser,

            telemetryRows: n,

            ...quota,
        };
    },


    // -------------------------------------------------------------------------
    // Reset
    // -------------------------------------------------------------------------

    async reset() {
        await exec(`
            DELETE FROM telemetry
        `);

        await exec(`
            DELETE FROM vehicles
        `);

        await exec(`
            DELETE FROM meta
        `);

        await flush();

        return true;
    },
};


// -----------------------------------------------------------------------------
// RPC
// -----------------------------------------------------------------------------

let queue = Promise.resolve();


self.onmessage = (event) => {
    const {
        id,
        method,
        args = [],
    } = event.data;


    queue = queue.then(
        async () => {
            try {
                if (method !== 'init') {
                    await ready();
                }


                const fn =
                    repo[method];


                if (
                    typeof fn !==
                    'function'
                ) {
                    throw new Error(
                        `Unknown repository method: ${method}`
                    );
                }


                const result =
                    await fn(...args);


                self.postMessage({
                    id,
                    ok: true,
                    result,
                });

            } catch (error) {
                console.error(
                    '[DB] RPC error:',
                    method,
                    error
                );


                self.postMessage({
                    id,

                    ok: false,

                    error: {
                        message:
                            String(
                                error?.message ||
                                error
                            ),

                        code:
                            error?.code,
                    },
                });
            }
        }
    );
};