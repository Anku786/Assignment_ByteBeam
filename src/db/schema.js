export const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS meta (
     key   VARCHAR PRIMARY KEY,
     value VARCHAR
   )`,
    `CREATE TABLE IF NOT EXISTS vehicles (
     id         VARCHAR PRIMARY KEY,
     data       JSON NOT NULL,
     position   INTEGER,
     updated_at TIMESTAMP DEFAULT current_timestamp
   )`,
    // One row per logical packet. packet_id PRIMARY KEY is the dedup guarantee.
    `CREATE TABLE IF NOT EXISTS telemetry (
     packet_id   VARCHAR   PRIMARY KEY,
     vehicle_id  VARCHAR   NOT NULL,
     seq         BIGINT,
     ts          TIMESTAMP NOT NULL,   -- event time (device clock)
     received_at TIMESTAMP NOT NULL,   -- commit time (local clock)
     lat         DOUBLE,
     lng         DOUBLE,
     speed       DOUBLE,
     fuel        DOUBLE,
     battery     DOUBLE,
     engine_temp DOUBLE,
     payload     JSON
   )`,
];

export const TABLES = ['meta', 'vehicles', 'telemetry'];
export const SIGNALS = ['lat', 'lng', 'speed', 'fuel', 'battery', 'engine_temp'];