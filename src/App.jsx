import { useState } from "react";
import { NavLink } from 'react-router-dom';
import { AppRoutes } from "./routes";
import { useTheme } from "./context/ThemeContext";
import { useSimulator } from "./context/SimulatorContext";

function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState("");
  const { theme, toggleTheme } = useTheme();
  const { running, start, stop, refresh } = useSimulator();

  const handleRefresh = async () => {
    await refresh();
  };

  return (
    <div className="app">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="logo">ϟ</div>
          <div className="brand-copy">
            <div className="brand-title">ByteBeam</div>
            <div className="brand-sub">Fleet Operations Platform</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" className="nav-item">
            <span className="nav-icon">▱</span>
            Vehicles
          </NavLink>
          <NavLink to="/attention" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <span className="nav-icon">△</span>
            Alerts
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <button type="button" className="collapse" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '→' : '←'}
            <span className="collapse-label">&nbsp; Collapse</span>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="search">
            <span>⌕</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search vehicles, locations, drivers..."
            />
          </div>
          <div className="top-actions">
            <button type="button" className={`live${running ? '' : ' paused'}`} onClick={running ? stop : start}>
              <i></i> {running ? 'Live' : 'Paused'}
            </button>
            <button className="icon-btn" onClick={handleRefresh} title="Refresh" type="button">
              ↻
            </button>
            <button className="icon-btn" onClick={toggleTheme} title="Theme" type="button">
              ☼
            </button>
            <div className="user">
              <div className="avatar">D</div>
              <div>
                <div className="user-name">Dummy</div>
                <div className="user-role">Fleet Operations</div>
              </div>
              <span>⌄</span>
            </div>
          </div>
        </header>
        <AppRoutes />
      </main>
    </div>
  )
}

export default App;
