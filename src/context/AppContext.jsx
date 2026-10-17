import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './ThemeContext';
import { FleetDataProvider } from './FleetDataContext';
export function AppProviders({ children }) {
    return (
        <BrowserRouter>
            <ThemeProvider>
                <FleetDataProvider>
                    {children}
                </FleetDataProvider>
            </ThemeProvider>
        </BrowserRouter>
    )
}