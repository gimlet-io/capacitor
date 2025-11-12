// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, onCleanup } from "solid-js";

export function useCalculateAge(startTime: string) {
  const [ageString, setAgeString] = createSignal("N/A");

  if (!startTime) return ageString;

  const start = new Date(startTime);
  
  const updateAge = () => {
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      setAgeString(`${days}d${hours % 24}h`);
      return null; // No recalculation needed
    } else if (hours > 0) {
      setAgeString(`${hours}h${minutes % 60}m`);
      return null; // No recalculation needed
    } else if (minutes > 0) {
      setAgeString(`${minutes}m`);
      return 60000; // Recalculate every minute
    } else {
      setAgeString(`${seconds}s`);
      return 1000; // Recalculate every second
    }
  };

  const intervalDuration = updateAge(); // Get the interval duration based on the initial age
  if (intervalDuration) {
    const interval = setInterval(updateAge, intervalDuration); // Update based on the calculated duration
    onCleanup(() => clearInterval(interval)); // Cleanup interval on component unmount
  }
  return ageString;
}

export function useCalculateTimeAgo(timestamp: string | undefined) {
  const [timeAgoString, setTimeAgoString] = createSignal("Never");

  if (!timestamp) return timeAgoString;

  const start = new Date(timestamp);
  
  const updateTimeAgo = () => {
    const now = new Date();
    const diff = now.getTime() - start.getTime();
    
    // Display time ago
    if (diff < 60000) { // less than a minute
      const seconds = Math.floor(diff / 1000);
      setTimeAgoString(`${seconds}s ago`);
      return 1000; // Recalculate every second
    } else if (diff < 3600000) { // less than an hour
      const minutes = Math.floor(diff / 60000);
      setTimeAgoString(`${minutes}m ago`);
      return 60000; // Recalculate every minute
    } else if (diff < 86400000) { // less than a day
      const hours = Math.floor(diff / 3600000);
      setTimeAgoString(`${hours}h ago`);
      return 3600000; // Recalculate every hour
    } else { // days
      const days = Math.floor(diff / 86400000);
      setTimeAgoString(`${days}d ago`);
      return 86400000; // Recalculate every day
    }
  };

  const intervalDuration = updateTimeAgo(); // Get the interval duration based on the initial time difference
  if (intervalDuration) {
    const interval = setInterval(updateTimeAgo, intervalDuration); // Update based on the calculated duration
    onCleanup(() => clearInterval(interval)); // Cleanup interval on component unmount
  }
  return timeAgoString;
}

export function useCalculateDuration(startTime: string | undefined, completionTime: string | undefined) {
  const [durationString, setDurationString] = createSignal("-");

  if (!startTime) return durationString;

  const start = new Date(startTime);
  const completion = completionTime ? new Date(completionTime) : null;
  
  const updateDuration = () => {
    const endTime = completion || new Date();
    const durationMs = endTime.getTime() - start.getTime();
    const durationSec = Math.floor(durationMs / 1000);
    
    if (durationSec < 60) {
      setDurationString(`${durationSec}s`);
      return completion ? null : 1000; // Update every second if not completed
    } else if (durationSec < 3600) {
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;
      setDurationString(`${minutes}m${seconds}s`);
      return completion ? null : 1000; // Update every second if not completed
    } else {
      const hours = Math.floor(durationSec / 3600);
      const minutes = Math.floor((durationSec % 3600) / 60);
      setDurationString(`${hours}h${minutes}m`);
      return completion ? null : 60000; // Update every minute if not completed
    }
  };

  const intervalDuration = updateDuration(); // Get the interval duration
  if (intervalDuration) {
    const interval = setInterval(updateDuration, intervalDuration); // Update based on the calculated duration
    onCleanup(() => clearInterval(interval)); // Cleanup interval on component unmount
  }
  return durationString;
}
