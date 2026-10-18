import { beforeEach, describe, expect, it, vi } from 'vitest';

const workers = [];

class MockWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        workers.push(this);
    }

    postMessage(message) {
        this.lastMessage = message;
    }

    terminate() { }
}

vi.stubGlobal('Worker', MockWorker);

const { fleetDb } = await import('../db/dbClient');

describe('fleetDb telemetry ingestion', () => {
    beforeEach(() => {
        workers.length = 0;
    });

    it('creates the telemetry worker when the database is initialized', async () => {
        const initPromise = fleetDb.init();

        expect(workers).toHaveLength(1);
        expect(workers[0].lastMessage).toBeDefined();

        // The dbClient is waiting for the worker response.
        // Respond to the initialization request.
        const request = workers[0].lastMessage;

        workers[0].onmessage?.({
            data: {
                id: request.id,
                ok: true,
                result: true,
            },
        });

        await initPromise;

        expect(workers).toHaveLength(1);
    });
});