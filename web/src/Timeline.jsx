import { useState } from "react";
import { format } from "date-fns";

const Timeline = ({ alerts }) => {
  const [hours, setHours] = useState([
    { hour: 24, current: false },
    { hour: 6, current: false },
    { hour: 1, current: true }
  ]);
  const selected = "font-medium"

  if (!alerts) {
    alerts=[];
  }

  const hourHandler = (input) => {
    setHours(hours.map(hour => {
      if (hour.hour === input) {
        return { ...hour, current: true }
      } else {
        return { ...hour, current: false }
      }
    }))
  }

  const currentHour = hours.find(hour => hour.current)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setHours(endDate.getHours() - currentHour.hour);

  return (
    <div>
      <div className="h-8">
        <div className="flex justify-end divide-x space-x-1 divide-neutral-300 text-neutral-600 text-xs">
          {hours.map(hour => {
            return (
              <button
                  key={hour.hour}
                  type="button"
                  onClick={() => hourHandler(hour.hour)}
                  className={(hour.current ? selected : "") + ' pl-1'}
                >
                  {hour.hour === 1 ? "Last hour" : ` Last ${hour.hour} hours`}
                 
                </button>
            )
          })}
        </div>
        <div className="relative flex bg-green-300 h-6">
          {alerts.map((alert, index) => {
            const pendingAt = new Date(alert.pendingAt * 1000);
            const resolvedAt = new Date(alert.resolvedAt ? (alert.resolvedAt * 1000) : Date.now());
            const startPosition = Math.max(0, (pendingAt - startDate) / (60 * 60 * 1000));
            const endPosition = Math.min(currentHour.hour, (resolvedAt - startDate) / (60 * 60 * 1000));

            const endDateUnix = (new Date(endDate).getTime() / 1000).toFixed(0)
            const total = (alert.resolvedAt && alert.resolvedAt !== 0 ? alert.resolvedAt : endDateUnix) - alert.pendingAt
            let pendingInterval = 0
            let firingInterval = 0

            if (alert.status === "Pending") {
              pendingInterval = endDateUnix - alert.pendingAt
            } else if (alert.status === "Firing") {
              pendingInterval = alert.firedAt - alert.pendingAt
              firingInterval = endDateUnix - alert.firedAt
            } else if (alert.status === "Resolved") {
              pendingInterval = (alert.firedAt !== 0 ? alert.firedAt : alert.resolvedAt) - alert.pendingAt
              firingInterval = alert.firedAt !== 0 ? alert.resolvedAt - alert.firedAt : 0
            }

            const alertStyle = {
              left: `${(startPosition / currentHour.hour) * 100}%`,
              width: `${((endPosition - startPosition) / currentHour.hour) * 100}%`,
            };

            if (((endPosition - startPosition) / currentHour.hour) < 0) {
              return null
            }

            const resolvedAtLabel = alert.resolvedAt !== 0 ? `Resolved at ${format(alert.resolvedAt * 1000, 'h:mm:ss a, MMMM do yyyy')}` : "";
            const firedAtLabel = alert.firedAt !== 0 ? `Alert fired at ${format(alert.firedAt * 1000, 'h:mm:ss a, MMMM do yyyy')}` : "";

            return (
              <div
                key={index}
                className="absolute"
                style={alertStyle}
              >
                <div
                  className="flex h-6 bg-yellow-300">
                  <div
                    style={{ width: `${pendingInterval / total * 100}%` }}
                    className="bg-yellow-300 transition-all duration-500 ease-out"
                    title={`${alert.name} Alert Pending for pod ${alert.objectName}

Since ${format(alert.pendingAt * 1000, 'h:mm:ss a, MMMM do yyyy')}
`}
                  ></div>
                  <div
                    style={{ width: `${firingInterval / total * 100}%` }}
                    className="bg-red-300 transition-all duration-500 ease-out"
                    title={`${alert.name} Alert Firing for pod ${alert.objectName}

Problem first noticed at ${format(alert.pendingAt * 1000, 'h:mm:ss a, MMMM do yyyy')}
${firedAtLabel}
${resolvedAtLabel}`}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
