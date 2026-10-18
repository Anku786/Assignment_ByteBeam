import { describe, expect, it } from 'vitest';
import {
    ONLINE_MS,
    STALE_MS,
} from '../context/FleetDataContext.jsx';

function getConnection(now, lastReceived) {
    if (lastReceived == null) return 'never';

    if (now - lastReceived <= ONLINE_MS) {
        return 'online';
    }

    if (now - lastReceived <= STALE_MS) {
        return 'stale';
    }

    return 'offline';
}

describe('vehicle connection status', () => {
    const now = 1_000_000;

    it('marks a recently received vehicle as online', () => {
        expect(getConnection(now, now - 10_000)).toBe('online');
    });

    it('marks a vehicle as stale after 30 seconds', () => {
        expect(getConnection(now, now - 60_000)).toBe('stale');
    });

    it('marks a vehicle as offline after 2 minutes', () => {
        expect(getConnection(now, now - 121_000)).toBe('offline');
    });

    it('marks a vehicle with no telemetry as never', () => {
        expect(getConnection(now, null)).toBe('never');
    });
});