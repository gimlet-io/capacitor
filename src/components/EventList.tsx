import { For } from "solid-js/web";
import { createSignal } from "solid-js";
import type { Event } from "../types/k8s.ts";

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