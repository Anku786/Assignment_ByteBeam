import { useFleetData } from '../../context/FleetDataContext';

export function FleetStats() {
    const { rows = [] } = useFleetData();

    const counts = rows.reduce(
        (acc, row) => {
            const speed = Number(row.speed);
            const battery = Number(row.battery);
            const fuel = Number(row.fuel);
            const engineTemp = Number(row.engine_temp ?? row.engineTemp);

            if (
                row.connection === 'offline' ||
                row.connection === 'never'
            ) {
                acc.offline += 1;
                return acc;
            }

            if (
                (Number.isFinite(battery) && battery < 10) ||
                (Number.isFinite(fuel) && row.type !== 'EV' && fuel < 5) ||
                (Number.isFinite(engineTemp) && engineTemp >= 110)
            ) {
                acc.critical += 1;
                return acc;
            }

            if (Number.isFinite(speed) && speed > 0) {
                acc.moving += 1;
            }

            return acc;
        },
        {
            moving: 0,
            offline: 0,
            critical: 0,
        },
    );

    const stats = [
        { label: 'Vehicles', value: rows.length },
        { label: 'Moving', value: counts.moving },
        { label: 'Offline', value: counts.offline },
        { label: 'Critical', value: counts.critical },
    ];

    return (
        <>
            {stats.map((stat) => (
                <div key={stat.label} className="card kpi">
                    <div className="kpi-title">{stat.label}</div>
                    <div className="kpi-value">{stat.value}</div>
                    <div className="kpi-icon">▣</div>
                </div>
            ))}
        </>
    );
}