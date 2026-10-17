const FleetOverview = () => {
    return (
        <section className="content">
            <div className="page-head">
                <div className="page-title-wrap">
                    <div className="page-icon">▣</div>
                    <div><h1>Fleet Overview</h1><div className="page-sub">Real-time summary of your fleet operations</div></div>
                </div>
            </div>
            {/* <FleetStats rows={rows} openCount={openAttention.filter((item) => item.status === 'open').length} />
            <FleetChart />
            <DataTable columns={columns} rows={rows} onRowClick={(row) => navigate(`/vehicles/${row.id}`)} /> */}
        </section>
    )
}

export default FleetOverview;