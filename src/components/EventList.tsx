import { For } from "solid-js/web";
import type { Event } from "../types/k8s.ts";

export function EventList(props: { events: Event[] }) {
  return (
    <div class="events-list">
      <div class="events-container">
        <For each={props.events}>
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
      </div>
    </div>
  );
} 