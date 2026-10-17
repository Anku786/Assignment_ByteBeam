import { Navigate, Route, Routes } from 'react-router-dom'
import FleetOverview from '../components/fleet'
// import { AttentionRoute } from './AttentionRoute.jsx'
// import { VehicleRoute } from './VehicleRoute.jsx'
export function AppRoutes() {
    return (
        <Routes>
            <Route path="/" element={<FleetOverview />} />
            {/* <Route path="/vehicles/:vehicleId" element={<VehicleRoute />} />
            <Route path="/attention" element={<AttentionRoute />} /> */}
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}