// Single source of truth for the browser-side DuckDB schema.
export const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS vehicles (
        id VARCHAR PRIMARY KEY,
        data JSON NOT NULL,
        position INTEGER,
        updated_at TIMESTAMP DEFAULT current_timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS telemetry (
        packet_id VARCHAR PRIMARY KEY,
        vehicle_id VARCHAR NOT NULL,
        seq BIGINT,
        ts TIMESTAMP NOT NULL,
        received_at TIMESTAMP NOT NULL,
        lat DOUBLE,
        lng DOUBLE,
        speed DOUBLE,
        fuel DOUBLE,
        battery DOUBLE,
        battery_temp DOUBLE,
        engine_temp DOUBLE,
        payload JSON
    )`,
];

export const TABLES = ['vehicles', 'telemetry'];
export const SIGNALS = [
    'lat',
    'lng',
    'speed',
    'fuel',
    'battery',
    'battery_temp',
    'engine_temp',
];
