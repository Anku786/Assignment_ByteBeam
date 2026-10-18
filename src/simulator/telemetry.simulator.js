import { fleetDb } from '../db/dbClient';

const TICK_MS = 5000;
const FLEET_SIZE = 500;
const CHUNK = 500;
const MAX_CATCHUP = 12;

const DRIVERS = ['Asha', 'Ravi', 'Meera', 'Imran', 'Priya', 'Kiran'];

const FLEET = Array.from({ length: FLEET_SIZE }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
        id: `V-${n}`,
        name: `Truck ${n}`,
        plate: `KA-01-${1000 + i * 7}`,
        driver: DRIVERS[i % DRIVERS.length],
        type: 'EV',
        odometer: 12000 + i * 37,
    };
});

function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function mulberry32(seed) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const round = (value, digits = 1) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

function makePacket(vehicle, seq, t0, receivedAt = Date.now()) {
    const rnd = mulberry32(hash32(`${vehicle.id}|${seq}`));
    const phase = (hash32(vehicle.id) % 628) / 100;
    const speed = Math.max(
        0,
        55 + 30 * Math.sin(seq / 25 + phase) + (rnd() - 0.5) * 6,
    );

    // Values deliberately move on every tick so the UI visibly changes.
    const battery = Math.max(
        5,
        100 - ((seq * 0.18 + phase * 5) % 75),
    );
    const fuel = Math.max(
        5,
        100 - ((seq * 0.35 + phase * 8) % 90),
    );
    const batteryTemp = 28 + speed * 0.08 + (rnd() - 0.5) * 3;
    const engineTemp = 45 + speed * 0.18 + (rnd() - 0.5) * 5;

    const packet = {
        packetId: `${vehicle.id}:${seq}`,
        vehicleId: vehicle.id,
        seq,
        ts: t0 + seq * TICK_MS,
        receivedAt,
        lat: round(12.9716 + 0.05 * Math.sin(seq / 200 + phase) + phase * 0.001, 5),
        lng: round(77.5946 + 0.05 * Math.cos(seq / 200 + phase), 5),
        speed: round(speed),
        fuel: round(fuel),
        battery: round(battery),
        batteryTemp: round(batteryTemp),
        engineTemp: round(engineTemp),
    };

    return packet;
}

function makePartialPacket(vehicle, seq, t0) {
    const packet = makePacket(vehicle, seq, t0);
    const variant = hash32(`${vehicle.id}|partial|${seq}`) % 4;

    if (variant === 0) {
        delete packet.battery;
        delete packet.batteryTemp;
    } else if (variant === 1) {
        delete packet.lat;
        delete packet.lng;
    } else if (variant === 2) {
        delete packet.fuel;
    } else {
        delete packet.speed;
        delete packet.engineTemp;
    }

    packet.payloadType = 'partial';
    return packet;
}

function createTickPackets(seq, t0) {
    const packets = [];

    for (const vehicle of FLEET) {
        // A deterministic subset goes silent for a few ticks.
        const missing = hash32(`${vehicle.id}|missing|${seq}`) % 97 === 0;
        if (missing) continue;

        const packet = seq % 11 === 0
            ? makePartialPacket(vehicle, seq, t0)
            : makePacket(vehicle, seq, t0);

        packets.push(packet);

        // Duplicate packets are intentionally inserted with the same packetId.
        if (hash32(`${vehicle.id}|duplicate|${seq}`) % 53 === 0) {
            packets.push({ ...packet });
        }
    }

    // Backlog / late packets: on selected ticks, add older packets again.
    if (seq > 8 && seq % 17 === 0) {
        const backlogSeq = seq - 5;
        for (let i = 0; i < FLEET.length; i += 17) {
            packets.push(makePacket(FLEET[i], backlogSeq, t0));
        }
    }

    // Out-of-order arrival: reverse deterministic chunks of the current batch.
    if (seq % 7 === 0) {
        for (let start = 0; start < packets.length; start += 50) {
            packets.splice(start, 50, ...packets.slice(start, start + 50).reverse());
        }
    }

    return packets;
}

let t0 = null;
let timer = null;
let busy = false;
let running = false;
let starting = false;
let lastSeq = -1;
let onError = null;

async function tick() {
    if (busy || t0 == null) return;

    busy = true;
    try {
        const current = Math.floor((Date.now() - t0) / TICK_MS);
        const fromSeq = Math.max(lastSeq + 1, current - MAX_CATCHUP);

        for (let seq = fromSeq; seq <= current; seq += 1) {
            const packets = createTickPackets(seq, t0);

            for (let i = 0; i < packets.length; i += CHUNK) {
                const result = await fleetDb.ingestTelemetry(
                    packets.slice(i, i + CHUNK),
                );

                // Keep ingestion failures visible without stopping the simulator.
                if (result.invalid > 0) {
                    console.warn('Invalid telemetry packets:', result.invalid);
                }
            }
        }

        lastSeq = current;
    } catch (error) {
        onError?.(error);
    } finally {
        busy = false;
    }
}

export const simulator = {
    async start({ onError: handler } = {}) {
        if (running || starting) return;

        starting = true;
        onError = handler ?? null;

        try {
            await fleetDb.init();
            await fleetDb.upsertVehicles(FLEET);

            // A new run starts a new event-time clock. The period before this
            // point intentionally behaves like a missing interval.
            t0 = Date.now();
            lastSeq = -1;
            running = true;

            await tick();
            timer = setInterval(tick, TICK_MS);
        } finally {
            starting = false;
        }
    },

    async generateFreshBatch() {
        await fleetDb.init();
        await fleetDb.upsertVehicles(FLEET);

        const freshT0 = Date.now();
        return FLEET.map((vehicle) => makePacket(vehicle, 0, freshT0));
    },

    stop() {
        clearInterval(timer);
        timer = null;
        running = false;
        t0 = null;
        lastSeq = -1;
    },

    getFleet() {
        return FLEET;
    },
};
