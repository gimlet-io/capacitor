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
