import Table from "./Table";

const FleetOverview = () => {
    return (
        <section className="content">
            <div className="page-head">
                <div className="page-title-wrap">
                    <div className="page-icon">▣</div>
                    <div><h1>Fleet Overview</h1><div className="page-sub">Real-time summary of your fleet operations</div></div>
                </div>
            </div>
            <Table />
        </section>
    )
}

export default FleetOverview;