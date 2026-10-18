import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VehicleHeader } from './header';
import { useFleetData } from '../../context/FleetDataContext';
import { formatTime } from '../../utils/format';

const VehicleDetail = () => {
    const { vehicleId } = useParams();
    const { rows, status, attention, getTelemetryHistory } = useFleetData();
    const [history, setHistory] = useState([]);
    const vehicle = rows.find((row) => row.id === vehicleId);
    const events = useMemo(
        () =>
            attention
                .filter((item) => item.vehicleId === vehicleId)
                .slice(0, 12)
                .map((item) => ({
                    id: item.id,
                    title: item.title ?? item.ruleId?.replaceAll('_', ' ') ?? 'Alert',
                    detail: `${item.message ?? 'open'}`,
                    severity: item.severity ?? item.level,
                    timeLabel: item.lastSeenAt
                        ? formatTime(item.lastSeenAt)
                        : 'Current',
                })),
        [attention, vehicleId],
    );

    useEffect(() => {
        if (!vehicleId) return;

        let cancelled = false;

        getTelemetryHistory(vehicleId, 30)
            .then((packets) => {
                if (!cancelled) setHistory(packets);
            })
            .catch((error) => {
                console.error('Failed to load telemetry history:', error);
                if (!cancelled) setHistory([]);
            });

        return () => {
            cancelled = true;
        };
    }, [vehicleId, getTelemetryHistory]);

    if (status === 'initializing') {
        return <div className="page">Loading vehicle...</div>;
    }

    if (!vehicle) {
        return <div className="page">Vehicle not found.</div>;
    }

    return (
        <div className="page">
            <p><Link to="/">← Fleet</Link></p>

            <VehicleHeader vehicle={vehicle} />

            <section className="metric-grid">
                <article><p>Speed</p><strong>{vehicle.speed != null ? `${Math.round(Number(vehicle.speed))} km/h` : '—'}</strong></article>
                <article><p>Battery SOC</p><strong>{vehicle.battery != null ? `${Math.round(Number(vehicle.battery))}%` : '—'}</strong></article>
                <article><p>Battery Temp</p><strong>{vehicle.battery_temp != null ? `${Number(vehicle.battery_temp).toFixed(1)}°C` : '—'}</strong></article>
                <article><p>Ignition</p><strong>{vehicle?.speed == null ? '—' : vehicle.speed > 0 ? 'On' : 'Off'}</strong></article>
                <article><p>Odometer</p><strong>{vehicle.odometer != null ? `${Number(vehicle.odometer).toLocaleString()} km` : '—'}</strong></article>
                <article><p>GPS</p><strong>{vehicle.lat != null && vehicle.lng != null ? `${Number(vehicle.lat).toFixed(4)}, ${Number(vehicle.lng).toFixed(4)}` : '—'}</strong></article>
            </section>

            <div className='split'>
                <section>
                    <h2>Current attention</h2>
                    {vehicle.openAlerts?.length ? (
                        <ol className='timeline'>
                            {vehicle.openAlerts.map((alert) => (
                                <li className={`timeline-item severity-${alert.severity}`} key={alert.id}>{alert.severity ?? alert.level}: {alert.message ?? alert.text}</li>
                            ))}
                        </ol>
                    ) : (
                        <p>No current alert from fresh readings.</p>
                    )}
                </section>
                <section>
                    <h2>Recent packets</h2>

                    <ul className="packet-list">
                        {history.map((packet) => (
                            <li key={packet.id}>
                                <span>#{packet.seq}</span>
                                <span>
                                    {packet.speed != null
                                        ? `${Math.round(Number(packet.speed))} km/h`
                                        : '—'}
                                </span>
                                <span>
                                    {packet.fuel != null
                                        ? `${Math.round(Number(packet.fuel))}%`
                                        : '—'}
                                </span>
                                <time>
                                    {packet.receivedAt
                                        ? formatTime(packet.receivedAt)
                                        : '—'}
                                </time>
                            </li>
                        ))}
                    </ul>

                    {history.length === 0 && (
                        <p>No telemetry packets available.</p>
                    )}
                </section>
            </div>
        </div>
    );
};

export default VehicleDetail;
