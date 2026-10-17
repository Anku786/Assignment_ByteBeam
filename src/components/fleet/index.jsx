import Alert from "./Alert";
import BatteryHealth from "../Charts/BatteryHealth";
import Table from "./Table";
import Activity from "../Charts/Activity";
import Status from "../Charts/Status";
import { FleetStats } from "./KPI";


const FleetOverview = () => {
    return (
        <section className="content">
            <div className="page-head">
                <div className="page-title-wrap">
                    <div className="page-icon">▣</div>
                    <div><h1>Fleet Overview</h1><div className="page-sub">Real-time summary of your fleet operations</div></div>
                </div>
            </div>
            <div className="kpis">
                <FleetStats />
            </div>
            <div className="middle">
                <Activity />
                <Status />
                <BatteryHealth />
            </div>
            <div className="table-wrap">
                <Table />
                <Alert />
            </div>
        </section>
    )
}

export default FleetOverview;