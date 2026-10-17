import { useState } from "react";
import { useFleetData } from "../../context/FleetDataContext";
import { TOTAL_PAGES } from "../../constants/stringConstants";

const rowsPerPage = TOTAL_PAGES;

const Table = () => {
    const [currentPage, setCurrentPage] = useState(1)
    const { rows } = useFleetData()


    const totalPages = Math.ceil(rows.length / rowsPerPage)

    const startIndex = (currentPage - 1) * rowsPerPage
    const endIndex = startIndex + rowsPerPage

    const visibleVehicles = rows.slice(startIndex, endIndex)

    const columns = [
        { key: 'name', header: 'Vehicle ID / Name' },
        {
            key: 'battery_per',
            header: 'Battery %',
        },
        {
            key: 'health',
            header: 'Health',
        },
        {
            key: 'status',
            header: 'Ignition',
        },
        {
            key: 'fuel',
            header: 'Fuel',
            render: (row) =>
                row.latest
                    ? `${Math.round(row.latest.fuelPct)}%`
                    : '—',
        },
        {
            key: 'freshness',
            header: 'Freshness',
        },
        {
            key: 'alerts',
            header: 'Alerts',
        },
    ]

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
                        {visibleVehicles?.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className="empty">
                                    No Rows
                                </td>
                            </tr>
                        ) : (
                            visibleVehicles?.map((row) => (
                                <tr
                                    key={row.id}
                                >
                                    {columns.map((column) => (
                                        <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>
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
            <div className="table-footer"><span>Showing 1–10 of 500 vehicles</span>
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