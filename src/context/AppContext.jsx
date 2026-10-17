import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import { FleetDataProvider } from './FleetDataContext';
import { SimulatorProvider } from './SimulatorContext';
export function AppProviders({ children }) {
    return (
        <BrowserRouter>
            <ThemeProvider>
                <FleetDataProvider>
                    <SimulatorProvider>
                        {children}
                    </SimulatorProvider>
                </FleetDataProvider>
            </ThemeProvider>
        </BrowserRouter>
    )
}