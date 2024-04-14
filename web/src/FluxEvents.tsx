import React from 'react';
import { NavigationButton } from './NavigationButton.tsx'
import { TimeLabel } from './TimeLabel.tsx'
import { format } from "date-fns";
import { useState } from 'react';
import { FluxEvent } from './types/fluxEvent.ts';


export type FluxEventsProps = {
  events: FluxEvent[];
  handleNavigationSelect: any;
}
function FluxEvents(props: FluxEventsProps) {
  const { events, handleNavigationSelect } = props
  const [filter, setFilter] = useState(false)

  let filteredEvents = events;
  if (filter) {
    filteredEvents = filteredEvents.filter(e => e.type === "Warning")
  }

  return (
    <div className="space-y-4">
      <button className={(filter ? "text-blue-50 bg-blue-600" : "bg-gray-50 text-gray-600") + " rounded-full px-3"}
        onClick={() => setFilter(!filter)}
      >
        Filter errors
      </button>
      <div className="flow-root bg-white p-4 rounded-lg">
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full py-2 align-middle">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0">
                    Last Seen
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Object
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Reason
                  </th>
                  <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredEvents.map((e, index) => {
                  return (
                    <tr key={index} className={e.type === "Warning" ? "bg-orange-400" : ""}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">
                        <LastSeen event={e} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700">
                        <NavigationButton handleNavigation={() => handleNavigationSelect(e.involvedObjectKind === "Kustomization" ? "Kustomizations" : "Sources", e.involvedObjectNamespace, e.involvedObject, e.involvedObjectKind)}>
                          {e.involvedObjectKind}: {e.involvedObjectNamespace}/{e.involvedObject}
                        </NavigationButton>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700">{e.type}</td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-700">{e.reason}</td>
                      <td className="px-3 py-4 text-sm text-gray-700">{e.message}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function LastSeen(props) {
  const { event } = props

  const firstTimestampSince = event.eventTime !== "0001-01-01T00:00:00Z" ? event.eventTime : event.firstTimestamp
  const firstTimestampSinceParsed = Date.parse(firstTimestampSince, "yyyy-MM-dd'T'HH:mm:ss");
  const firstTimestampSinceExactDate = format(firstTimestampSinceParsed, 'MMMM do yyyy, h:mm:ss a O')

  if (event.series) {
    const lastObservedTimeParsed = Date.parse(event.series.lastObservedTime, "yyyy-MM-dd'T'HH:mm:ss");
    const lastObservedTimeExactDate = format(lastObservedTimeParsed, 'MMMM do yyyy, h:mm:ss a O')
    return (
      <span>
        <TimeLabel title={lastObservedTimeExactDate} date={lastObservedTimeParsed} />
        <span className='px-1'>ago (x{event.series.count} over</span>
        <TimeLabel title={firstTimestampSinceExactDate} date={firstTimestampSinceParsed} />
        )
      </span>
    )
  } else if (event.count > 1) {
    const lastTimestampParsed = Date.parse(event.lastTimestamp, "yyyy-MM-dd'T'HH:mm:ss");
    const lastTimestampExactDate = format(lastTimestampParsed, 'MMMM do yyyy, h:mm:ss a O')
    return (
      <span>
        <TimeLabel title={lastTimestampExactDate} date={lastTimestampParsed} />
        <span className='px-1'>ago (x{event.count} over</span>
        <TimeLabel title={firstTimestampSinceExactDate} date={firstTimestampSinceParsed} />
        )
      </span>
    )
  } else {
    return (<span><TimeLabel title={firstTimestampSinceExactDate} date={firstTimestampSinceParsed} /> ago</span>)
  }
}

export default FluxEvents;
