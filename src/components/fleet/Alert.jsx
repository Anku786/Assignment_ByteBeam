import { useMemo } from 'react';
import { useFleetData } from '../../context/FleetDataContext';

// Thresholds are examples; tune them to your fleet.
const getAlerts = (row) => {
    const alerts = [];
    const l = row;

    // Connection status
    if (row.connection === 'offline') {
        alerts.push({
            level: 'crit',
            text: 'Offline',
        });
    } else if (
        row.connection === 'stale' ||
        (
            l.received_at != null &&
            Date.now() - Number(l.received_at) > 2 * 60 * 1000
        )
    ) {
        alerts.push({
            level: 'warn',
            text: 'Stale data',
        });
    }

    if (!l) return alerts;

    const battery = l.battery;
    const fuel = l.fuel;
    const engineTemp = l.engineTemp ?? l.engine_temp;

    // Determine vehicle type
    let vehicleType = row.type ?? l.type;

    if (!vehicleType && row.data) {
        try {
            const data = typeof row.data === 'string'
                ? JSON.parse(row.data)
                : row.data;

            vehicleType = data.type;
        } catch {
            // Ignore malformed vehicle metadata.
        }
    }

    // Battery alerts
    if (battery != null && battery < 10) {
        alerts.push({
            level: 'crit',
            text: 'Critical battery',
        });
    } else if (battery != null && battery < 20) {
        alerts.push({
            level: 'warn',
            text: 'Low battery',
        });
    }

    // Fuel alerts: skip EVs
    if (vehicleType !== 'EV' && fuel != null && fuel < 5) {
        alerts.push({
            level: 'crit',
            text: 'Critical fuel',
        });
    } else if (
        vehicleType !== 'EV' &&
        fuel != null &&
        fuel < 20
    ) {
        alerts.push({
            level: 'warn',
            text: 'Low fuel',
        });
    }

    // Engine temperature alerts
    if (engineTemp != null && engineTemp >= 110) {
        alerts.push({
            level: 'crit',
            text: 'Engine temperature critical',
        });
    } else if (engineTemp != null && engineTemp >= 100) {
        alerts.push({
            level: 'warn',
            text: 'High engine temperature',
        });
    }

    return alerts;
};

const Alert = () => {
    const { rows } = useFleetData();

    const groups = useMemo(() => {
        const critical = [];
        const warnings = [];
        const attention = [];

        rows.forEach((row) => {
            getAlerts(row).forEach((alert) => {
                const item = {
                    id: row.id,
                    name: row.name,
                    text: alert.text,
                    time: row.received_at,
                };

                if (alert.level === 'crit') {
                    critical.push(item);
                } else if (alert.level === 'warn') {
                    warnings.push(item);
                } else {
                    attention.push(item);
                }
            });
        });

        return { critical, warnings, attention };
    }, [rows]);

    const formatTime = (timestamp) => {
        if (!timestamp) return 'No telemetry';

        const elapsed = Math.max(0, Date.now() - Number(timestamp));
        const minutes = Math.floor(elapsed / 60000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} min ago`;

        const hours = Math.floor(minutes / 60);
        return `${hours} hr ago`;
    };

    const renderSection = (title, items, className = '', countStyle = {}) => (
        <div className="alert-section">
            <div
                className="section-label"
                style={countStyle.label ? { color: countStyle.label } : undefined}
            >
                {title}
                <span style={countStyle.badge ? { background: countStyle.badge } : undefined}>
                    {items.length}
                </span>
            </div>

            {items.length === 0 ? (
                null
            ) : (
                items.slice(0, 5).map((item, index) => (
                    <div className={`alert-item ${className} `} key={`${item.id} -${item.text} -${index} `}>
                        <div className="alert-symbol">△</div>
                        <div>
                            <div className="alert-vehicle">{item.id}</div>
                            <div className="alert-text">{item.text}</div>
                        </div>
                        <div className="alert-time">{formatTime(item.time)}</div>
                    </div>
                ))
            )}
        </div>
    );

    return (
        <aside className="card alerts">
            <div className="alerts-head">
                <div className="alerts-title">Alerts &amp; Issues</div>
                <span className="view-all">View all →</span>
            </div>

            {renderSection('Critical Alerts', groups.critical)}
            {renderSection('Data quality & warning', groups.warnings, 'warning', {
                label: '#f1ae3a',
                badge: '#c77b16',
            })}
            {renderSection('Attention queue', groups.attention, 'info', {
                label: '#a98cff',
                badge: '#7043d5',
            })}
        </aside>
    );
};

export default Alert;