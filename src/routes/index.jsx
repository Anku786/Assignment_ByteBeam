import { Navigate, Route, Routes } from 'react-router-dom'
import FleetOverview from '../components/fleet'
import Alert from '../components/Alert'
import VehicleDetail from '../components/VehicleDetail'

export function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<FleetOverview />} />
            <Route path="/vehicles/:vehicleId" element={<VehicleDetail />} />
            <Route path="/alert" element={<Alert />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}