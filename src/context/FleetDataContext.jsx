import { createContext, useContext } from 'react';
import { dummyVehicles } from '../constants/stringConstants';

const FleetDataContext = createContext(null)

export const FleetDataProvider = ({ children }) => {
    const value = {
        rows: dummyVehicles,
    };
    return <FleetDataContext.Provider value={value}>{children}</FleetDataContext.Provider>
}

export function useFleetData() {
    const value = useContext(FleetDataContext)
    if (!value) throw new Error('useFleetData must be used within FleetDataProvider')
    return value
}