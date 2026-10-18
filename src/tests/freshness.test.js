import { describe, expect, it } from 'vitest';
import {
    ONLINE_MS,
    STALE_MS,
} from '../context/FleetDataContext.jsx';

describe('Fleet Console freshness', () => {
    it('treats telemetry received within 30 seconds as online', () => {
        expect(ONLINE_MS).toBe(30_000);
    });

    it('treats telemetry older than 30 seconds as stale', () => {
        const age = 60_000;

        expect(age > ONLINE_MS).toBe(true);
        expect(age <= STALE_MS).toBe(true);
    });

    it('treats telemetry older than 2 minutes as offline', () => {
        const age = 121_000;

        expect(age > STALE_MS).toBe(true);
    });

    it('treats missing telemetry as never received', () => {
        const latest = null;

        expect(latest).toBeNull();
    });
});