import { useMemo, useState } from 'react';
import AlertCard from './AlertCard.jsx';
import { useFleetData } from '../../context/FleetDataContext.jsx';

const Alert = () => {
    const { rows = [] } = useFleetData();
    const [acknowledged, setAcknowledged] = useState(() => new Set());
    const [undoId, setUndoId] = useState(null);

    const alerts = useMemo(
        () => rows
            .flatMap((row) => row.openAlerts ?? [])
            .filter((alert) => !acknowledged.has(alert.id)),
        [rows, acknowledged],
    );

    const acknowledge = (id) => {
        setAcknowledged((current) => {
            const next = new Set(current);
            next.add(id);
            return next;
        });
        setUndoId(id);
    };

    const undo = () => {
        if (!undoId) return;
        setAcknowledged((current) => {
            const next = new Set(current);
            next.delete(undoId);
            return next;
        });
        setUndoId(null);
    };

    return (
        <div className="page">
            <header className="page-header">
                <div>
                    <p className="eyebrow">Exceptions</p>
                    <h1>Attention</h1>
                </div>
            </header>

            <h2>Open ({alerts.length})</h2>

            {undoId ? (
                <p className="attention-undo">
                    Attention acknowledged.{' '}
                    <button type="button" onClick={undo}>Undo</button>
                </p>
            ) : null}

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
                            onAck={acknowledge}
                        />
                    );
                })}
            </div>
        </div>
    );
};

export default Alert;
