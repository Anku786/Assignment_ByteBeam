import { useMemo } from 'react';
import { useFleetData } from '../../context/FleetDataContext';

const BatteryHealth = () => {
    const { rows } = useFleetData();

    const health = useMemo(() => {
        const counts = {
            excellent: 0,
            good: 0,
            fair: 0,
            poor: 0,
            critical: 0,
        };

        rows.forEach((row) => {
            const battery = Number(row.battery);

            if (!Number.isFinite(battery)) return;

            if (battery >= 90) {
                counts.excellent++;
            } else if (battery >= 70) {
                counts.good++;
            } else if (battery >= 40) {
                counts.fair++;
            } else if (battery >= 20) {
                counts.poor++;
            } else {
                counts.critical++;
            }
        });

        const total = rows.length;

        return {
            ...counts,
            total,
        };
    }, [rows]);

    const maxCount = Math.max(
        health.excellent,
        health.good,
        health.fair,
        health.poor,
        health.critical,
        1
    );

    const items = [
        {
            label: 'Excellent 90–100%',
            count: health.excellent,
            color: '#35c97d',
            barClass: 'greenbar',
        },
        {
            label: 'Good 70–89%',
            count: health.good,
            color: '#35c97d',
            barClass: 'greenbar',
        },
        {
            label: 'Fair 40–69%',
            count: health.fair,
            color: '#e4aa45',
            barClass: 'amberbar',
        },
        {
            label: 'Poor 20–39%',
            count: health.poor,
            color: '#d98d2d',
            barClass: 'amberbar',
        },
        {
            label: 'Critical <20%',
            count: health.critical,
            color: '#ef5a61',
            barClass: 'redbar',
        },
    ];

    return (
        <section className="panel">
            <div className="panel-title">Battery Health</div>
            <div className="panel-sub">Distribution across fleet</div>

            <div className="health-list">
                {items.map((item) => (
                    <div className="health-row" key={item.label}>
                        <div>
                            <div
                                className="health-label"
                                style={{ color: item.color }}
                            >
                                {item.label}
                            </div>

                            <div className="health-bar">
                                <span
                                    className={item.barClass}
                                    style={{
                                        width: `${(item.count / maxCount) * 100}%`,
                                    }}
                                />
                            </div>
                        </div>

                        <div className="health-count">
                            {item.count}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default BatteryHealth;