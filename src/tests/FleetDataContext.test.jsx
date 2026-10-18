import { describe, expect, it } from 'vitest';
import {
    ONLINE_MS,
    STALE_MS,
} from '../context/FleetDataContext.jsx';

describe('FleetDataContext freshness thresholds', () => {
    it('uses 30 seconds as the online threshold', () => {
        expect(ONLINE_MS).toBe(30_000);
    });

    it('uses 2 minutes as the stale threshold', () => {
        expect(STALE_MS).toBe(120_000);
    });

    it('classifies a recently received vehicle as online', () => {
        const now = 1_000_000;
        const lastReceived = now - 10_000;

        const connection =
            now - lastReceived <= ONLINE_MS
                ? 'online'
                : now - lastReceived <= STALE_MS
                    ? 'stale'
                    : 'offline';

        expect(connection).toBe('online');
    });

    it('classifies telemetry older than 30 seconds as stale', () => {
        const now = 1_000_000;
        const lastReceived = now - 60_000;

        const connection =
            now - lastReceived <= ONLINE_MS
                ? 'online'
                : now - lastReceived <= STALE_MS
                    ? 'stale'
                    : 'offline';

        expect(connection).toBe('stale');
    });

    it('classifies telemetry older than 2 minutes as offline', () => {
        const now = 1_000_000;
        const lastReceived = now - 121_000;

        const connection =
            now - lastReceived <= ONLINE_MS
                ? 'online'
                : now - lastReceived <= STALE_MS
                    ? 'stale'
                    : 'offline';

        expect(connection).toBe('offline');
    });

    it('classifies a vehicle with no telemetry as never', () => {
        const lastReceived = null;

        const connection =
            lastReceived == null
                ? 'never'
                : 'online';

        expect(connection).toBe('never');
    });
});