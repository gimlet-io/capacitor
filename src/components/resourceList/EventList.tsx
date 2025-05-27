import { For } from "solid-js/web";
import { createSignal } from "solid-js";
import type { Event } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";
import { useCalculateAge } from './timeUtils.ts';

export function EventList(props: { events: Event[] }) {
  const [showAll, setShowAll] = createSignal(false);
  
  const sortedEvents = () => {
    return [...props.events]
      .sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime())
      .slice(0, 100);
  };

  const displayEvents = () => {
    const events = sortedEvents();
    return showAll() ? events : events.slice(0, 10);
  };

  return (
    <div class="events-list">
      <div class="events-container">
        <For each={displayEvents()}>
          {(event) => (
            <div class={`event-item ${event.type.toLowerCase()}`}>
              <div class="event-header">
                <span class="event-type">{event.type}</span>
                <span class="event-reason">{event.reason}</span>
                <span class="event-count" title="Occurrence count">×{event.count}</span>
              </div>
              <div class="event-object">
                {event.involvedObject.kind}/{event.involvedObject.name}
              </div>
              <div class="event-message">{event.message}</div>
              <div class="event-timestamp">
                {new Date(event.lastTimestamp).toLocaleString()}
              </div>
            </div>
          )}
        </For>
        {props.events.length > 100 && (
          <div class="events-truncated">
            Showing most recent 100 events
          </div>
        )}
        {!showAll() && props.events.length > 10 && (
          <button 
            class="show-more-events" 
            onClick={() => setShowAll(true)}
          >
            Show {Math.min(props.events.length, 100) - 10} more events
          </button>
        )}
      </div>
    </div>
  );
}

export const eventTypeFilter: Filter = {
  name: "EventType",
  label: "Type",
  type: "select",
  options: [
    { label: "Normal", value: "Normal", color: "var(--linear-green)" },
    { label: "Warning", value: "Warning", color: "var(--linear-red)" },
  ],
  multiSelect: true,
  filterFunction: (event: Event, value: string): boolean => {
    return event.type === value;
  },
};

// Default sorting function to order events by lastTimestamp, most recent first
export const sortEventsByLastSeen = (events: Event[]): Event[] => {
  return [...events].sort((a, b) => 
    new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

export const eventColumns = [
  {
    header: "TYPE",
    width: "7%",
    accessor: (event: Event) => {
      const color = event.type === "Normal" 
        ? "var(--linear-green)" 
        : "var(--linear-red)";
      
      return <span style={`color: ${color}; font-weight: 500;`}>{event.type}</span>;
    },
  },
  {
    header: "LAST SEEN",
    width: "8%",
    accessor: (event: Event) => useCalculateAge(event.lastTimestamp)(),
    title: (event: Event) => event.lastTimestamp,
  },
  {
    header: "COUNT",
    width: "5%",
    accessor: (event: Event) => <>{event.count}</>,
  },
  {
    header: "REASON",
    width: "15%",
    accessor: (event: Event) => <>{event.reason}</>,
    title: (event: Event) => event.reason,
  },
  {
    header: "OBJECT",
    width: "20%",
    accessor: (event: Event) => (
      <>{`${event.involvedObject.kind}/${event.involvedObject.name}`}</>
    ),
    title: (event: Event) => `${event.involvedObject.kind}/${event.involvedObject.name}`,
  },
  {
    header: "MESSAGE",
    width: "42%",
    accessor: (event: Event) => <>{event.message}</>,
    title: (event: Event) => event.message,
  },
  {
    header: "SOURCE",
    width: "15%",
    accessor: (event: Event) => <>{event.source.component}</>,
    title: (event: Event) => event.source.component,
  },
]; 