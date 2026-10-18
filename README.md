# Fleet Console

A React-based fleet monitoring console for viewing vehicle telemetry, connection state, freshness, alerts, and recent telemetry activity.

---

## 1. How to Run the Application

### Install Dependencies

```bash
npm install
```

Start the Development Server
```npm run dev ```

Vite will display the local URL in the terminal. It is typically:
```http://localhost:5173```

Create a Production Build
```npm run build```

## 2. How to Run Tests

Install dependencies first:
```npm install```

Run the test suite:
```npm test```

The project uses Vitest for automated testing.
If you see:
```vitest: command not found```

install the project dependencies:
```npm install```

If Vitest is not present in package.json, install it as a development dependency:
```npm install -D vitest```

3. Architecture Overview
Fleet Console is a React application with a browser-side DuckDB-Wasm data layer.
The main architecture is:
React UI
   |
   v
FleetDataContext
   |
   +-- Freshness calculation
   +-- Vehicle status derivation
   +-- Alert derivation
   +-- Dashboard / detail state
   |
   v
dbClient
   |
   v
DuckDB-Wasm Worker
   |
   +-- vehicles
   +-- telemetry
   |
   v
OPFS persistence
   |
   +-- IndexedDB snapshot fallback

UI Layer
The React UI provides:
- Fleet overview/dashboard
- Vehicle status and telemetry
- Vehicle detail views
- Current attention/alert information
- Recent telemetry packets
- Connection and freshness indicators
State Layer
FleetDataContext acts as the application-level state and derivation layer.
It converts database rows into UI-ready vehicle records containing:
- Latest telemetry
- Signal freshness
- Connection state
- Vehicle status
- Current alerts
- Open alerts
- Ignition state
- Odometer information
This keeps business rules out of individual UI components.
Database Layer
Database operations are isolated behind dbClient.
The UI does not directly execute DuckDB queries. Database operations are performed by the DuckDB-Wasm worker, keeping database operations away from the main React thread.
4. Database and Persistence Choices
The application uses DuckDB-Wasm as the local analytical database.
The primary database is stored using:
opfs://fleet-console-v2.db

The application uses two main tables:
vehicles
telemetry

Vehicles
The vehicles table stores the fleet vehicle records.
Telemetry
The telemetry table stores incoming telemetry packets and signal values.
Telemetry includes values such as:
- Speed
- Fuel
- Battery state of charge
- Battery temperature
- Engine temperature
- Latitude
- Longitude
- Timestamps
- Packet sequence information
DuckDB-Wasm was selected because it provides an SQL-based analytical database directly in the browser and is well suited to querying telemetry data without requiring a separate backend service.
The application also has an IndexedDB snapshot fallback so that the locally persisted fleet database can be recovered when the preferred OPFS database is unavailable.
Database access is performed inside a Web Worker to avoid blocking the browser's main UI thread.
5. Simulator / Telemetry Ingestion Behavior
Telemetry is ingested through the database client and processed by the DuckDB worker.
Incoming packets are persisted into the telemetry table and associated with vehicles in the fleet.
The ingestion path also handles duplicate packet protection so that the same telemetry packet is not repeatedly inserted.
The latest telemetry state is derived from the persisted telemetry rather than from hard-coded dashboard values.
The application therefore uses the actual telemetry dataset for:
- Vehicle state
- Latest signal values
- Freshness
- Alert evaluation
- Dashboard information
- Vehicle detail information
No synthetic alert objects are inserted into the UI simply to make the dashboard appear populated.
For demonstration purposes, alert conditions can be produced by ingesting telemetry values that cross the application's configured thresholds.
6. Status, Freshness and Alert Derivation Rules
Freshness
Telemetry freshness is calculated using the timestamp of the relevant reading.
The current thresholds are:
Age	State
<= 30 seconds	Fresh
> 30 seconds and <= 120 seconds	Stale
> 120 seconds	Offline


The application also evaluates freshness independently for individual signals such as:
- Speed
- Fuel
- Battery
- Battery temperature
- Engine temperature
- GPS latitude/longitude
This prevents an old reading from being treated as current simply because another signal has recently updated.
Vehicle Status
Vehicle status is derived using the following precedence:
1. No telemetry → Offline
2. Overall connection is offline → Offline
3. A critical alert exists → Critical
4. A non-critical alert exists → Attention
5. Battery or speed telemetry is not fresh → Uncertain
6. Fresh speed greater than 0 → Moving
7. Otherwise → Idle
This ordering ensures that safety conditions take precedence over normal movement or idle state.
Current Alerts
The current implementation derives alerts from fresh telemetry.
Battery SOC
Battery SOC	Result
< 10%	Critical battery
>= 10% and < 20%	Low battery warning
>= 20%	No battery alert


Battery Temperature
Battery Temperature	Result
> 45°C	Critical battery overheating
<= 45°C	No battery-temperature alert


Alerts are evaluated only when the relevant signal is fresh. A stale value is not treated as a new active safety alert.
The resulting alert information is exposed through the fleet data context and used by the dashboard and vehicle-detail screens.
7. Product and UI Decisions
The interface was designed around the needs of a fleet operator rather than exposing the underlying database structure.
Fleet-First Overview
The main dashboard prioritizes the information an operator needs to answer quickly:
- How many vehicles are active?
- Which vehicles require attention?
- Which vehicles are offline?
- Which vehicles are moving?
- What telemetry is currently available?
Status Hierarchy
Vehicle status uses a small number of operational states:
Moving
Idle
Attention
Critical
Uncertain
Offline

This makes the fleet state easy to scan without requiring the operator to interpret raw telemetry values.
Freshness Visibility
Telemetry freshness is displayed explicitly because a value without a timestamp can be misleading in an operational monitoring application.
A stale or offline vehicle is therefore not presented as though its latest reading were current.
Vehicle Detail
Selecting a vehicle provides a deeper view of:
- Latest telemetry
- Current status
- Current alerts
- Recent packets
- Signal timestamps
This creates a two-level workflow:
Fleet overview
      |
      v
Identify problem
      |
      v
Vehicle detail
      |
      v
Inspect telemetry

No Fabricated Operational Data
The UI is driven by persisted telemetry and derived state rather than manually created alert cards or hard-coded vehicle conditions.
This keeps the dashboard behavior representative of the actual data pipeline.
8. Known Limitations and Future Improvements
The current implementation is intentionally focused on the assignment requirements. With more time, I would improve the following areas.
Persistent Alert / Event History
The current alert implementation derives the current alert state from fresh telemetry.
A production fleet system would maintain a separate alert/event history table containing:
- Event ID
- Vehicle ID
- Rule ID
- Severity
- Opened timestamp
- Acknowledged timestamp
- Resolved timestamp
- Resolution reason
- Triggering telemetry packet
This would allow the UI to distinguish clearly between:
Open
Acknowledged
Resolved

and provide a historical attention timeline.
More Alert Rules
The current implementation focuses on battery-related safety rules.
A production implementation could add rules for:
- Overspeed
- Low fuel
- Engine temperature
- Prolonged idling
- GPS loss
- Telemetry timeout
- Abnormal battery temperature
- Repeated signal dropouts
These rules should be represented as configurable rule definitions rather than being embedded directly in UI code.
Backend Synchronization
The current application is browser-local and uses DuckDB-Wasm.
A production fleet platform would typically add a backend ingestion service for:
- Centralized telemetry collection
- Authentication
- Multi-user access
- Server-side persistence
- Fleet-wide alert processing
- Synchronization between operators/devices
Authentication and Authorization
The assignment version does not implement a full user-management system.
A production application would support role-based access such as:
Fleet Admin
Fleet Manager
Dispatcher
Read-only Viewer

Larger-Scale Telemetry
DuckDB-Wasm is a good fit for the assignment and local analytical workloads.
For very large fleets and continuous high-frequency telemetry, I would move long-term storage and aggregation to a server-side time-series or analytical system while retaining browser-side caching for the active fleet view.
Automated Test Coverage
The next iteration would expand integration tests around:
- Telemetry ingestion
- Duplicate packet handling
- Schema migration
- Persistence/reload behavior
- Freshness transitions
- Alert transitions
- Vehicle status transitions
- Worker/client communication
9. AI Tools and Conversation Disclosure
During development, I used multiple AI tools as development assistants.
I did not use paid subscriptions for these tools; I used the available free access to each tool as needed.
ChatGPT
ChatGPT was used primarily to:
- Create and refine the initial HTML/CSS UI design and layout for the Fleet Console
- Discuss application architecture and implementation decisions
- Review React component structure
- Reason about telemetry freshness and status rules
- Identify edge cases in alert derivation
- Debug implementation issues
- Review DuckDB-Wasm persistence and worker interactions
- Write and structure this README/documentation
Cursor
Cursor was used to:
- Convert the initial HTML implementation into a React-based application
- Assist with React component structure and integration
- Help write and structure the automated test cases
Claude
Claude was used primarily for guidance around DuckDB / DuckDB-Wasm, as this was an area where I had less prior experience.
It helped me understand:
- Database setup
- SQL queries
- DuckDB-Wasm worker integration
- Database persistence
The AI tools were used as development assistants rather than replacements for implementation and verification.
Generated suggestions were reviewed, adapted, and tested against the actual application.