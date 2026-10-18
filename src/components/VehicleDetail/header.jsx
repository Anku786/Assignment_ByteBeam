import { FreshnessBadge } from "../Badge/FreshnessBadge";
import { StatusBadge } from "../Badge/StatusBadge";

export function VehicleHeader({ vehicle }) {
    return (
        <header className="page-header">
            <div>
                <p className="eyebrow">{vehicle.vin}</p>
                <h1>{vehicle.name}</h1>
                <p className="muted">
                    {vehicle.plate} · {vehicle.type}
                </p>
            </div>
            <div className="header-badges">
                <StatusBadge status={vehicle.status} />
                <FreshnessBadge freshness={vehicle.freshness} />
            </div>
        </header>
    )
}
