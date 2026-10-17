import { useMemo } from 'react';
import { useFleetData } from '../../context/FleetDataContext';

const Activity = () => {
  const { rows = [] } = useFleetData();

  const activity = useMemo(() => {
    const today = new Date();
    const days = [];

    // Create the last 7 calendar days.
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - i);

      days.push({
        date,
        key: date.toISOString().slice(0, 10),
        label: date.toLocaleDateString('en-IN', {
          month: 'short',
          day: 'numeric',
        }),
        count: 0,
      });
    }

    // Count vehicles by their latest telemetry date.
    rows.forEach((row) => {
      const timestamp = Number(row.received_at);

      if (!timestamp || Number.isNaN(timestamp)) return;

      const date = new Date(timestamp);
      date.setHours(0, 0, 0, 0);

      const key = date.toISOString().slice(0, 10);

      const day = days.find((item) => item.key === key);

      if (day) {
        day.count += 1;
      }
    });

    return days;
  }, [rows]);

  const maxCount = Math.max(...activity.map((day) => day.count), 1);

  // Convert values into SVG points.
  const points = activity.map((day, index) => {
    const x = activity.length === 1
      ? 300
      : (index / (activity.length - 1)) * 600;

    const y = 160 - (day.count / maxCount) * 125;

    return {
      ...day,
      x,
      y,
    };
  });

  const linePath = points
    .map((point, index) =>
      `${ index === 0 ? 'M' : 'L' } ${ point.x } ${ point.y } `
    )
    .join(' ');

  const areaPath = `${ linePath } L 600 180 L 0 180 Z`;

  const latestDay = [...activity]
    .reverse()
    .find((day) => day.count > 0);

  return (
    <section className="panel">
      <div className="panel-title">Fleet Activity</div>

      <div className="panel-sub">
        Vehicles reporting by day
      </div>

      <div className="chart">
        <svg
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient
              id="fleetActivityFill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0"
                stopColor="#2874ff"
                stopOpacity=".24"
              />
              <stop
                offset="1"
                stopColor="#2874ff"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          <path
            d={areaPath}
            fill="url(#fleetActivityFill)"
          />

          <path
            d={linePath}
            fill="none"
            stroke="#2b78ff"
            strokeWidth="2.2"
          />

          {points.map((point) => (
            <circle
              key={point.key}
              cx={point.x}
              cy={point.y}
              r="3"
              fill="#2b78ff"
            />
          ))}
        </svg>

        {latestDay && (
          <div className="tooltip">
            <strong>
              {latestDay.date.toLocaleDateString('en-IN', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </strong>
            <br />
            {latestDay.count} vehicles
          </div>
        )}
      </div>

      <div className="xlabels">
        {activity.map((day, index) => (
          <span key={day.key}>
            {index === 0 || index === 2 || index === 4 || index === 6
              ? day.label
              : ''}
          </span>
        ))}
      </div>
    </section>
  );
};

export default Activity;
