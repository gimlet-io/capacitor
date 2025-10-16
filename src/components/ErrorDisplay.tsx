// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { Show } from "solid-js";
import { useErrorStore } from "../store/errorStore.tsx";

interface ErrorDisplayProps {
  class?: string;
}

export function ErrorDisplay(props: ErrorDisplayProps) {
  const errorStore = useErrorStore();

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString();
  };

  return (
    <Show when={errorStore.currentError}>
      {(error) => {
        return (
          <div class={`error-display ${props.class || ''}`}>
            <div class="error-container">            
              <div class="error-content">
                <div class="error-message">{error().message}</div>
                <div class="error-timestamp">
                  <small>Error occurred at {formatTimestamp(error().timestamp)}</small>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
} 