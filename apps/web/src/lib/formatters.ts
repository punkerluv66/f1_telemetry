export function formatLapTime(seconds: number | null) {
  if (seconds === null) {
    return "N/A";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  return formatMsAsLapTime(totalMilliseconds);
}

export function formatMsAsLapTime(timeMs: number) {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1_000);
  const milliseconds = Math.abs(Math.round(timeMs % 1_000));

  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function formatDelta(deltaMs: number) {
  const seconds = (deltaMs / 1000).toFixed(3);
  return `${deltaMs > 0 ? "+" : ""}${seconds} s`;
}

export function formatClockTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
