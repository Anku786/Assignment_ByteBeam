import { Link } from 'react-router-dom';
import { StatusBadge } from '../Badge/StatusBadge';

const AlertCard = ({ item, vehicleName }) => {
    return (
        <article className={`attention-card severity-${item.severity}`}>
            <header>
                <StatusBadge status={item.severity} />
                <span className={`badge badge-${item.status}`}>{item.status}</span>
            </header>
            <h3>{item.title ?? item.text ?? 'Attention'}</h3>
            <p>{item.message ?? item.text}</p>
            <p className="muted">
                <Link to={`/vehicles/${item.vehicleId}`}>
                    {vehicleName ?? item.vehicleId}
                </Link>
            </p>
        </article>
    );
};

export default AlertCard;
