import { useMemo } from 'react';
import { useFleetData } from '../../context/FleetDataContext';

const Status = () => {
    const { rows } = useFleetData();

    const status = useMemo(() => {
        let fresh = 0;
        let partial = 0;
        let offline = 0;

        rows.forEach((row) => {
            if (row.connection === 'online') {
                fresh++;
            } else if (row.connection === 'stale') {
                partial++;
            } else {
                offline++;
            }
        });

        const reporting = fresh + partial;
        const total = rows.length;

        return {
            fresh,
            partial,
            offline,
            reporting,
            total,
        };
    }, [rows]);

    const reportingPercent =
        status.total > 0
            ? Math.round((status.reporting / status.total) * 100)
            : 0;

    return (
        <section className="panel">
            <div className="panel-title">Fleet Reporting Status</div>
            <div className="panel-sub">Current telemetry session</div>

            <div className="donut-wrap">
                <div
                    className="donut"
                    style={{
                        background: `conic-gradient(
              #7c3aed 0% ${(status.fresh / Math.max(status.total, 1)) * 100}%,
              #2b78ff ${(status.fresh / Math.max(status.total, 1)) * 100}% ${((status.fresh + status.partial) / Math.max(status.total, 1)) * 100}%,
              #d1d5db ${((status.fresh + status.partial) / Math.max(status.total, 1)) * 100}% 100%
            )`,
                    }}
                >
                    <div className="donut-center">
                        <div>
                            <strong>{status.reporting}</strong>
                            <span>Reporting</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="charging-legend">
                <div className="legend-box legend-purple">
                    FRESH
                    <strong>{status.fresh}</strong>
                </div>

                <div className="legend-box legend-blue">
                    PARTIAL
                    <strong>{status.partial}</strong>
                </div>

                <div className="legend-box legend-gray">
                    OFFLINE
                    <strong>{status.offline}</strong>
                </div>
            </div>
        </section>
    );
};

export default Status;