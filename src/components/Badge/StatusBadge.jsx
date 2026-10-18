const STATUS_UI = {
    moving: { className: 'moving', label: 'Moving' },
    charging: { className: 'charging', label: 'Charging' },
    idle: { className: 'idle', label: 'Idle' },
    degraded: { className: 'idle', label: 'Idle' },
    attention: { className: 'alert', label: 'Alert' },
    critical: { className: 'alert', label: 'Alert' },
    offline: { className: 'offline', label: 'Offline' },
}
export function StatusBadge({ status }) {
    const ui = STATUS_UI[status] ?? STATUS_UI.idle
    return (
        <span className={`status ${ui.className}`}>
            <i></i>
            {ui.label}
        </span>
    )
}