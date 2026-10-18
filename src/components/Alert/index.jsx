import { useMemo, useState } from 'react';
import AlertCard from './AlertCard.jsx';
import { useFleetData } from '../../context/FleetDataContext.jsx';

const Alert = () => {
    const { rows = [] } = useFleetData();

    const alerts = useMemo(
        () => rows
            .flatMap((row) => row.openAlerts ?? [])
            .filter((alert) => alert.id),
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
                    <p className="empty-copy">No open attention items.</p>
                ) : null}

                {alerts.map((item) => {
                    const row = rows.find((vehicle) => vehicle.id === item.vehicleId);

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
};

export default Alert;
