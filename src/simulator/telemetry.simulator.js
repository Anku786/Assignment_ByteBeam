import { fleetDb } from '../db/dbClient';

// Fixed stream clock: seq = floor((now - t0) / TICK_MS). Do not change once data exists,
// because packet ids (vehicleId:seq) are derived from seq.
const TICK_MS = 5000;
const FLEET_SIZE = 500;
const CHUNK = 500;
const MAX_CATCHUP = 60; // ticks to catch up after a throttled/background tab

const DRIVERS = ['Asha', 'Ravi', 'Meera', 'Imran', 'Priya', 'Kiran'];
const FLEET = Array.from({ length: FLEET_SIZE }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
        id: `V-${n}`,
        name: `Truck ${n}`,
        plate: `KA-01-${1000 + i * 7}`,
        driver: DRIVERS[i % DRIVERS.length],
        type: i % 3 === 0 ? 'EV' : 'Diesel',
    };
});

// ---------- deterministic packet generation ----------
function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
function mulberry32(a) {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// Pure function of (vehicle, seq, t0): the same inputs always give the identical packet.
function makePacket(v, seq, t0) {
    const rnd = mulberry32(hash32(`${v.id}|${seq}`));
    const phase = (hash32(v.id) % 628) / 100;
    const speed = Math.max(0, 55 + 30 * Math.sin(seq / 25 + phase) + (rnd() - 0.5) * 6);
    return {
        packetId: `${v.id}:${seq}`,
        vehicleId: v.id,
        seq,
        ts: t0 + seq * TICK_MS,
        lat: round(12.9716 + 0.05 * Math.sin(seq / 200 + phase) + phase * 0.001, 5),
        lng: round(77.5946 + 0.05 * Math.cos(seq / 200 + phase), 5),
        speed: round(speed, 1),
        fuel: round(100 - ((seq * 0.03 + phase * 8) % 85), 1),
        battery: round(100 - ((seq * 0.02 + phase * 5) % 70), 1),
        engineTemp: round(70 + speed * 0.25 + (rnd() - 0.5) * 4, 1),
    };
}

// ---------- state ----------
let t0 = null;
let timer = null;
let busy = false;
let running = false;
let starting = false;
let lastSeq = -1;
let onError = null;

async function ensureT0() {
    const saved = await fleetDb.getMeta('sim_t0');
    if (saved) {
        t0 = Number(saved);
    } else {
        t0 = Date.now();
        await fleetDb.setMeta('sim_t0', t0);
    }
}

async function tick() {
    if (busy || t0 == null) return;
    busy = true;
    try {
        const current = Math.floor((Date.now() - t0) / TICK_MS);
        if (lastSeq < current - MAX_CATCHUP) lastSeq = current - MAX_CATCHUP;

        const packets = [];
        for (let s = lastSeq + 1; s <= current; s++) {
            for (const v of FLEET) packets.push(makePacket(v, s, t0));
        }
        for (let i = 0; i < packets.length; i += CHUNK) {
            await fleetDb.ingestTelemetry(packets.slice(i, i + CHUNK));
        }
        // Advance only after everything was committed. A retry after a failure is safe:
        // already-stored packets are rejected as duplicates by packet_id.
        lastSeq = current;
    } catch (e) {
        onError?.(e);
    } finally {
        busy = false;
    }
}

// ---------- public API ----------
export const simulator = {
    async start({ onError: handler } = {}) {
        if (running || starting) return;
        starting = true;
        onError = handler ?? null;
        try {
            await fleetDb.init();
            await fleetDb.upsertVehicles(FLEET); // seeds the fleet (idempotent)
            await ensureT0();
            // After a reload we resume at "now"; the closed period is a missing interval.
            lastSeq = Math.floor((Date.now() - t0) / TICK_MS) - 1;
            running = true;
            timer = setInterval(tick, TICK_MS);
            tick();
        } finally {
            starting = false;
        }
    },

    stop() {
        clearInterval(timer);
        timer = null;
        running = false;
        t0 = null; // re-read from the database on the next start
    },
};