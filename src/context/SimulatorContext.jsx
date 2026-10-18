import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { simulator } from '../simulator/telemetry.simulator.js';
import { fleetDb } from '../db/dbClient.js';

const SimulatorContext = createContext(null);

export const SimulatorProvider = ({ children }) => {
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const start = useCallback(async () => {
        try {
            setError(null);
            await simulator.start({ onError: setError });
            setRunning(true);
        } catch (e) {
            setError(e);
            setRunning(false);
        }
    }, []);

    const stop = useCallback(() => {
        simulator.stop();
        setRunning(false);
    }, []);

    const refresh = useCallback(async () => {
        try {
            setError(null);
            setRefreshing(true);

            simulator.stop();
            setRunning(false);

            const records = await simulator.generateFreshBatch();

            await fleetDb.refreshTelemetry(records, simulator.getFleet());
        } catch (e) {
            setError(e);
        } finally {
            setRefreshing(false);
        }
    }, []);

    useEffect(() => () => simulator.stop(), []);

    const value = useMemo(
        () => ({ running, error, refreshing, start, stop, refresh }),
        [running, error, refreshing, start, stop, refresh]
    );

    return (
        <SimulatorContext.Provider value={value}>
            {children}
        </SimulatorContext.Provider>
    );
};

export function useSimulator() {
    const value = useContext(SimulatorContext);

    if (!value) {
        throw new Error('useSimulator must be used within SimulatorProvider');
    }

    return value;
}