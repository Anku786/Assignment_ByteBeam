import { useEffect, useState } from "react";
import { useFleetData } from "../../context/FleetDataContext";
import { TOTAL_PAGES } from "../../constants/stringConstants";

const rowsPerPage = TOTAL_PAGES;

// ---- helpers: derive display values from the latest DB readings ----
const formatAge = (ms) => {
    if (ms < 0) ms = 0;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3_600_000)}h ago`;
};

const fmt = (v, digits = 0) => (v == null ? '—' : `${v.toFixed(digits)}`);

// Thresholds are examples; tune them to your fleet.
const getAlerts = (row) => {
    const alerts = [];
    const l = row;

    // Connection status
    if (row.connection === 'offline') {
        alerts.push({
            level: 'crit',
            text: 'Offline',
        });
    } else if (
        row.connection === 'stale' ||
        (
            l.received_at != null &&
            Date.now() - Number(l.received_at) > 2 * 60 * 1000
        )
    ) {
        alerts.push({
            level: 'warn',
            text: 'Stale data',
        });
    }

    if (!l) return alerts;

    const battery = l.battery;
    const fuel = l.fuel;
    const engineTemp = l.engineTemp ?? l.engine_temp;

    // Determine vehicle type
    let vehicleType = row.type ?? l.type;

    if (!vehicleType && row.data) {
        try {
            const data = typeof row.data === 'string'
                ? JSON.parse(row.data)
                : row.data;

            vehicleType = data.type;
        } catch {
            // Ignore malformed vehicle metadata.
        }
    }

    // Battery alerts
    if (battery != null && battery < 10) {
        alerts.push({
            level: 'crit',
            text: 'Critical battery',
        });
    } else if (battery != null && battery < 20) {
        alerts.push({
            level: 'warn',
            text: 'Low battery',
        });
    }

    // Fuel alerts: skip EVs
    if (vehicleType !== 'EV' && fuel != null && fuel < 5) {
        alerts.push({
            level: 'crit',
            text: 'Critical fuel',
        });
    } else if (
        vehicleType !== 'EV' &&
        fuel != null &&
        fuel < 20
    ) {
        alerts.push({
            level: 'warn',
            text: 'Low fuel',
        });
    }

    // Engine temperature alerts
    if (engineTemp != null && engineTemp >= 110) {
        alerts.push({
            level: 'crit',
            text: 'Engine temperature critical',
        });
    } else if (engineTemp != null && engineTemp >= 100) {
        alerts.push({
            level: 'warn',
            text: 'High engine temperature',
        });
    }

    return alerts;
};

const getHealth = (row) => {
    if (!row) return 'Unknown';

    const alerts = getAlerts(row);

    if (alerts.some((alert) => alert.level === 'crit')) {
        return 'Critical';
    }

    if (alerts.length > 0) {
        return 'Warning';
    }

    return 'Good';
};

const Table = () => {
    const [currentPage, setCurrentPage] = useState(1)
    const { rows, status, error } = useFleetData()

    const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

    // keep the page valid if the row count changes
    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages)
    }, [currentPage, totalPages])

    const startIndex = (currentPage - 1) * rowsPerPage
    const endIndex = startIndex + rowsPerPage

    const visibleVehicles = rows.slice(startIndex, endIndex)

    const columns = [
        {
            key: 'id',
            header: 'Vehicle ID / Name',
        },
        {
            key: 'battery',
            header: 'Battery %',
            render: (row) => (<div className={`battery ${row.battery > 70 ? "green" : row.battery < 10 ? "red" : "amber"}`}><span className="battery-track"><span style={{ width: `${row.battery}%` }}></span></span><b>{row.battery}%</b></div>),
        },
        {
            key: 'health',
            header: 'Health',
            render: (row) => getHealth(row),
        },
        {
            key: 'ignition',
            header: 'Ignition',
            render: (row) =>
                row?.speed == null ? '—' : row.speed > 0 ? 'On' : 'Off',
        },
        {
            key: 'fuel',
            header: 'Fuel',
            render: (row) => (row?.fuel == null ? '—' : `${Math.round(row.fuel)}%`),
        },
        {
            key: 'freshness',
            header: 'Freshness',
            render: (row) =>
                row.telemetry_ts
                    ? `${formatAge(Date.now() - row.telemetry_ts)}`
                    : 'No data',
        },
        {
            key: 'alerts',
            header: 'Alerts',
            render: (row) => {
                const alerts = getAlerts(row)
                return alerts.length ? alerts.map((a) => a.text).join(', ') : '—'
            },
        },
    ]

    const rowClass = (row) => {
        const alerts = getAlerts(row)
        if (row.connection === 'offline') return 'is-offline'
        if (alerts.some((a) => a.level === 'crit')) return 'is-critical'
        return ''
    }

    const getPages = () => {
        if (totalPages <= 7) {
            return Array.from(
                { length: totalPages },
                (_, index) => index + 1
            )
        }

        if (currentPage <= 3) {
            return [1, 2, 3, '...', totalPages]
        }

        if (currentPage >= totalPages - 2) {
            return [
                1,
                '...',
                totalPages - 2,
                totalPages - 1,
                totalPages,
            ]
        }

        return [
            1,
            '...',
            currentPage - 1,
            currentPage,
            currentPage + 1,
            '...',
            totalPages,
        ]
    }

    if (status === 'error') {
        return <section><p className="empty">Storage error: {error?.message}</p></section>
    }

    return (
        <section>
            <div className="table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th key={column.key}>{column.header}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {status === 'initializing' ? (
                            <tr>
                                <td colSpan={columns.length} className="empty">
                                    Loading local data…
                                </td>
                            </tr>
                        ) : visibleVehicles.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="empty">
                                    No rows. Click "Paused" in the top bar to start ingesting telemetry.
                                </td>
                            </tr>
                        ) : (
                            visibleVehicles.map((row) => (
                                <tr key={row.id} className={rowClass(row)}>
                                    {columns.map((column) => (
                                        <td key={column.key}>
                                            {column.render ? column.render(row) : row[column.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
            <div className="legend-line">
                <span className="legend-dot"><i className="sel"></i>Selected row</span>
                <span className="legend-dot"><i className="crit"></i>Critical alert</span>
                <span className="legend-dot"><i className="issue"></i>State/data issue</span>
                <span className="legend-dot"><i className="off"></i>Offline (muted)</span>
            </div>
            <div className="table-footer">
                <span>
                    Showing {rows.length ? startIndex + 1 : 0}–{Math.min(endIndex, rows.length)} of {rows.length} vehicles
                </span>
                <div className="pages">
                    <button
                        className="pagination"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                    >
                        «
                    </button>

                    <button
                        className="pagination"
                        onClick={() =>
                            setCurrentPage((page) => Math.max(1, page - 1))
                        }
                        disabled={currentPage === 1}
                    >
                        ‹
                    </button>

                    {getPages().map((page, index) =>
                        page === '...' ? (
                            <span
                                key={`dots-${index}`}
                                className="pagination"
                            >
                                …
                            </span>
                        ) : (
                            <button
                                key={page}
                                className={`pagination ${currentPage === page ? 'active' : ''
                                    }`}
                                onClick={() => setCurrentPage(page)}
                            >
                                {page}
                            </button>
                        )
                    )}

                    <button
                        className="pagination"
                        onClick={() =>
                            setCurrentPage((page) =>
                                Math.min(totalPages, page + 1)
                            )
                        }
                        disabled={currentPage === totalPages}
                    >
                        ›
                    </button>

                    <button
                        className="pagination"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                    >
                        »
                    </button>
                </div>
            </div>
        </section>
    )
}

export default Table;