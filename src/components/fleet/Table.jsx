import { useEffect, useState } from "react";
import { useNavigate } from 'react-router-dom'
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


// Thresholds are examples; tune them to your fleet.
const getAlerts = (row) => row?.openAlerts ?? [];

const getHealth = (row) => {
    if (!row) return 'Unknown';
    if (row.status === 'critical') return 'Critical';
    if (row.status === 'attention') return 'Warning';
    if (row.status === 'uncertain') return 'Uncertain';
    if (row.status === 'offline') return 'Offline';
    return 'Good';
};

const Table = () => {
    const [currentPage, setCurrentPage] = useState(1)
    const { rows, status, error } = useFleetData()
    const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

    const navigate = useNavigate()

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
            render: (row) => (<div className={`battery ${Number(row.battery) > 70 ? "green" : Number(row.battery) < 10 ? "red" : "amber"}`}><span className="battery-track"><span style={{ width: `${row.battery ?? 0}%` }}></span></span><b>{row.battery == null ? '—' : `${Math.round(Number(row.battery))}%`}</b></div>),
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
                row.received_at
                    ? `${formatAge(Date.now() - Number(row.received_at))}`
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
                            <tr key={row.id} className="clickable" onClick={() => navigate(`/vehicles/${row.id}`)}>
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