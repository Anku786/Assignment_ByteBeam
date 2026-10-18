import { useMemo } from 'react';
import AlertCard  from './AlertCard.jsx';
import { useFleetData } from '../../context/FleetDataContext.jsx';

function getAlerts(row) {
    const alerts = [];

    const battery = Number(row.battery);
    const fuel = Number(row.fuel);
    const engineTemp = Number(row.engine_temp ?? row.engineTemp);

    // Connection
    if (row.connection === 'offline') {
        alerts.push({
            id: `${row.id}-offline`,
            vehicleId: row.id,
            status: 'open',
            severity: 'critical',
            title: 'Offline',
            message: 'Vehicle is not reporting telemetry.',
        });
    } else if (
        row.connection === 'stale' ||
        (
            row.received_at != null &&
            Date.now() - Number(row.received_at) > 2 * 60 * 1000
        )
    ) {
        alerts.push({
            id: `${row.id}-stale`,
            vehicleId: row.id,
            status: 'open',
            severity: 'warning',
            title: 'Stale data',
            message: 'Telemetry has not been received recently.',
        });
    }

    // Battery
    if (Number.isFinite(battery)) {
        if (battery < 10) {
            alerts.push({
                id: `${row.id}-battery-critical`,
                vehicleId: row.id,
                status: 'open',
                severity: 'critical',
                title: 'Critical battery',
                message: `Battery level is ${battery}%.`,
            });
        } else if (battery < 20) {
            alerts.push({
                id: `${row.id}-battery-low`,
                vehicleId: row.id,
                status: 'open',
                severity: 'warning',
                title: 'Low battery',
                message: `Battery level is ${battery}%.`,
            });
        }
    }

    // Fuel - only relevant for non-EV vehicles
    if (row.type !== 'EV' && Number.isFinite(fuel)) {
        if (fuel < 5) {
            alerts.push({
                id: `${row.id}-fuel-critical`,
                vehicleId: row.id,
                status: 'open',
                severity: 'critical',
                title: 'Critical fuel',
                message: `Fuel level is ${fuel}%.`,
            });
        } else if (fuel < 20) {
            alerts.push({
                id: `${row.id}-fuel-low`,
                vehicleId: row.id,
                status: 'open',
                severity: 'warning',
                title: 'Low fuel',
                message: `Fuel level is ${fuel}%.`,
            });
        }
    }

    // Engine temperature
    if (Number.isFinite(engineTemp)) {
        if (engineTemp >= 110) {
            alerts.push({
                id: `${row.id}-temperature-critical`,
                vehicleId: row.id,
                status: 'open',
                severity: 'critical',
                title: 'Engine temperature critical',
                message: `Engine temperature is ${engineTemp}°C.`,
            });
        } else if (engineTemp >= 100) {
            alerts.push({
                id: `${row.id}-temperature-high`,
                vehicleId: row.id,
                status: 'open',
                severity: 'warning',
                title: 'High engine temperature',
                message: `Engine temperature is ${engineTemp}°C.`,
            });
        }
    }

    return alerts;
}

const Alert = () => {
    const { rows = [] } = useFleetData();

    const alerts = useMemo(
        () => rows.flatMap((row) => getAlerts(row)),
        [rows],
    );

    return (
        <div className="page">
            <header className="page-header">
                <div>
                    <p className="eyebrow">Exceptions</p>
                    <h1>Attention</h1>
                </div>
            </header>

            <h2>Open ({alerts.length})</h2>

            <div className="card-grid">
                {alerts.length === 0 ? (
                    <p className="empty-copy">
                        No open attention items.
                    </p>
                ) : null}

                {alerts.map((item) => {
                    const row = rows.find(
                        (vehicle) => vehicle.id === item.vehicleId,
                    );

                    return (
                        <AlertCard
                            key={item.id}
                            item={item}
                            vehicleName={row?.name ?? item.vehicleId}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export default Alert;