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
    const l = row.latest;
    if (row.connection === 'offline') alerts.push({ level: 'issue', text: 'Offline' });
    else if (row.connection === 'stale') alerts.push({ level: 'issue', text: 'Stale data' });
    if (l) {
        if (l.fuel != null && l.fuel < 25) alerts.push({ level: 'crit', text: 'Low fuel' });
        if (l.battery != null && l.battery < 35) alerts.push({ level: 'crit', text: 'Low battery' });
        if (l.engineTemp != null && l.engineTemp > 90) alerts.push({ level: 'crit', text: 'Engine hot' });
    }
    return alerts;
};

const getHealth = (row, alerts) => {
    if (!row.latest) return '—';
    if (alerts.some((a) => a.level === 'crit')) return 'Critical';
    if (alerts.length) return 'Warning';
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
            key: 'name',
            header: 'Vehicle ID / Name',
            render: (row) => `${row.id} / ${row.name ?? '—'}`,
        },
        {
            key: 'battery',
            header: 'Battery %',
            render: (row) => (row.latest ? `${fmt(row.latest.battery)}%` : '—'),
        },
        {
            key: 'health',
            header: 'Health',
            render: (row) => getHealth(row, getAlerts(row)),
        },
        {
            key: 'ignition',
            header: 'Ignition',
            // Derived: moving => on. Replace if you ingest a real ignition signal.
            render: (row) =>
                row.latest?.speed == null ? '—' : row.latest.speed > 0 ? 'On' : 'Off',
        },
        {
            key: 'fuel',
            header: 'Fuel',
            render: (row) => (row.latest?.fuel == null ? '—' : `${Math.round(row.latest.fuel)}%`),
        },
        {
            key: 'freshness',
            header: 'Freshness',
            render: (row) =>
                row.latest
                    ? `${row.connection} · ${formatAge(Date.now() - row.latest.lastReceived)}`
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