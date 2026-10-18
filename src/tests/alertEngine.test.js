import { describe, expect, it } from 'vitest';
import { getAlerts } from '../context/FleetDataContext.jsx';

describe('Fleet Console alerts', () => {
    const fresh = {
        battery: { state: 'fresh' },
        batteryTemp: { state: 'fresh' },
    };

    it('creates a warning for battery below 20%', () => {
        const alerts = getAlerts({
            id: 'V-001',
            battery: 15,
            battery_temp: 30,
            signalFreshness: fresh,
            hasTelemetry: true,
            connection: 'online',
        });

        expect(alerts).toHaveLength(1);

        expect(alerts[0]).toMatchObject({
            id: 'V-001-battery-soc',
            level: 'warn',
            severity: 'warning',
            title: 'Low battery',
        });
    });

    it('creates a critical alert for battery below 10%', () => {
        const alerts = getAlerts({
            id: 'V-002',
            battery: 8,
            battery_temp: 30,
            signalFreshness: fresh,
            hasTelemetry: true,
            connection: 'online',
        });

        expect(alerts).toHaveLength(1);

        expect(alerts[0]).toMatchObject({
            id: 'V-002-battery-soc',
            level: 'crit',
            severity: 'critical',
            title: 'Critical battery',
        });
    });

    it('creates a critical alert for battery temperature above 45°C', () => {
        const alerts = getAlerts({
            id: 'V-003',
            battery: 75,
            battery_temp: 48,
            signalFreshness: fresh,
            hasTelemetry: true,
            connection: 'online',
        });

        expect(alerts).toHaveLength(1);

        expect(alerts[0]).toMatchObject({
            id: 'V-003-battery-temperature',
            level: 'crit',
            severity: 'critical',
            title: 'Battery overheating',
        });
    });

    it('does not alert for normal battery values', () => {
        const alerts = getAlerts({
            id: 'V-004',
            battery: 75,
            battery_temp: 32,
            signalFreshness: fresh,
            hasTelemetry: true,
            connection: 'online',
        });

        expect(alerts).toEqual([]);
    });

    it('does not alert when the battery reading is stale', () => {
        const alerts = getAlerts({
            id: 'V-005',
            battery: 5,
            battery_temp: 50,
            signalFreshness: {
                battery: { state: 'stale' },
                batteryTemp: { state: 'stale' },
            },
            hasTelemetry: true,
            connection: 'stale',
        });

        expect(alerts).toEqual([]);
    });
});