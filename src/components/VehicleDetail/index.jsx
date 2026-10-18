import { Link, useParams } from 'react-router-dom'
import { VehicleHeader } from './header';
import { useFleetData } from '../../context/FleetDataContext';
import { formatAge } from '../../utils/format';

const VehicleDetail = () => {
    const { vehicleId } = useParams()
    const { rows } = useFleetData()
    const vehicle = rows.find((row) => row.id === vehicleId)
    return (
        <div className="page">
            <p>
                <Link to="/">← Fleet</Link>
            </p>
            <VehicleHeader vehicle={vehicle} />
            <section className="metric-grid">
                <article>
                    <p>Speed</p>
                    <strong>{vehicle ? `${Math.round(vehicle.speed)} km/h` : '—'}</strong>
                </article>
                <article>
                    <p>Fuel</p>
                    <strong>{vehicle ? `${Math.round(vehicle.fuel)}` : '—'}</strong>
                </article>
                <article>
                    <p>Ignition</p>
                    <strong>{vehicle ? (vehicle.speed ? 'On' : 'Off') : '—'}</strong>
                </article>
                <article>
                    <p>GPS</p>
                    <strong>
                        {vehicle?.lat != null ? `${vehicle.lat.toFixed(4)}, ${vehicle.lng.toFixed(4)}` : '—'}
                    </strong>
                </article>
            </section>
        </div>
    )
}

export default VehicleDetail;