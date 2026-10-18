import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VehicleHeader } from './header';
import { useFleetData } from '../../context/FleetDataContext';
import { formatTime } from '../../utils/format';
import Timeline from './Timeline';

const VehicleDetail = () => {
    const { vehicleId } = useParams();
    const {
        rows,
        status,
        attention,
        getTelemetryHistory,
    } = useFleetData();

    const [history, setHistory] = useState([]);

    const vehicle = rows.find((row) => row.id === vehicleId);

    const events = useMemo(
        () =>
            attention
                .filter((item) => item.id === vehicleId)
                .slice(0, 12)
                .map((item) => ({
                    id: `${item.id}-${item.lastSeenAt}`,
                    title: item.ruleId.replaceAll('_', ' '),
                    detail: `${item.message} · ${item.status}`,
                    severity: item.severity,
                    timeLabel: formatTime(item.lastSeenAt),
                })),
        [attention, vehicleId],
    )

    useEffect(() => {
        if (!vehicleId) return;

        let cancelled = false;

        const loadHistory = async () => {
            try {
                const packets = await getTelemetryHistory(vehicleId, 20);

                if (!cancelled) {
                    setHistory(packets);
                }
            } catch (error) {
                console.error('Failed to load telemetry history:', error);

                if (!cancelled) {
                    setHistory([]);
                }
            }
        };

        loadHistory();

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
            <p>
                <Link to="/">← Fleet</Link>
            </p>

            <VehicleHeader vehicle={vehicle} />

            <section className="metric-grid">
                <article>
                    <p>Speed</p>
                    <strong>
                        {vehicle.speed != null
                            ? `${Math.round(Number(vehicle.speed))} km/h`
                            : '—'}
                    </strong>
                </article>

                <article>
                    <p>Fuel</p>
                    <strong>
                        {vehicle.fuel != null
                            ? `${Math.round(Number(vehicle.fuel))}%`
                            : '—'}
                    </strong>
                </article>

                <article>
                    <p>Ignition</p>
                    <strong>{vehicle.ignition ?? '—'}</strong>
                </article>

                <article>
                    <p>Odometer</p>
                    <strong>
                        {vehicle.odometer != null
                            ? `${Number(vehicle.odometer).toLocaleString()} km`
                            : '—'}
                    </strong>
                </article>

                <article>
                    <p>GPS</p>
                    <strong>
                        {vehicle.lat != null && vehicle.lng != null
                            ? `${Number(vehicle.lat).toFixed(4)}, ${Number(vehicle.lng).toFixed(4)}`
                            : '—'}
                    </strong>
                </article>
            </section>

            <div className="split">
                <section>
                    <h2>Attention</h2>
                    <Timeline events={events} empty="No alert history for this vehicle." />
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