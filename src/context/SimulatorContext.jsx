import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { simulator } from '../simulator/telemetry.simulator.js';

const SimulatorContext = createContext(null);

export const SimulatorProvider = ({ children }) => {
    const [running, setRunning] = useState(false);
    const [error, setError] = useState(null);

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

    // Stop the timer if the provider ever unmounts.
    useEffect(() => () => simulator.stop(), []);

    const value = useMemo(
        () => ({ running, error, start, stop }),
        [running, error, start, stop]
    );

    return <SimulatorContext.Provider value={value}>{children}</SimulatorContext.Provider>;
};

export function useSimulator() {
    const value = useContext(SimulatorContext);
    if (!value) throw new Error('useSimulator must be used within SimulatorProvider');
    return value;
}