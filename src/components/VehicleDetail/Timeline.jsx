const Timeline = ({ events, empty = 'No events yet' }) => {
    if (!events.length) return <p className="empty-copy">{empty}</p>
    return (
        <ol className="timeline">
            {events.map((event) => (
                <li key={event.id} className={`timeline-item severity-${event.severity ?? 'info'}`}>
                    <div>
                        <strong>{event.title}</strong>
                        <p>{event.detail}</p>
                    </div>
                    <time>{event.timeLabel}</time>
                </li>
            ))}
        </ol>
    )
}

export default Timeline;