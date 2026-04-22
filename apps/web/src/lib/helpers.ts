import type { DriverLapSummary, DriverSessionSummary, ImportedSessionOverview } from "../types";
import { formatLapTime } from "./formatters";

export function getDriverById(overview: ImportedSessionOverview, driverId: number | null) {
  if (driverId === null) {
    return null;
  }

  return overview.driverSummaries.find((driver) => driver.id === driverId) ?? null;
}

export function getPreferredLapId(driver: DriverSessionSummary | null, currentLapId: number | null) {
  if (!driver) {
    return null;
  }

  if (currentLapId && driver.laps.some((lap) => lap.id === currentLapId && lap.lapDuration !== null)) {
    return currentLapId;
  }

  return getPreferredLap(driver)?.id ?? null;
}

export function getPreferredLap(driver: DriverSessionSummary) {
  const cleanTimedLap = driver.laps
    .filter((lap) => lap.lapDuration !== null && !lap.isPitOutLap && !lap.isPitLap)
    .sort(compareLapDurations)[0];

  if (cleanTimedLap) {
    return cleanTimedLap;
  }

  return driver.laps
    .filter((lap) => lap.lapDuration !== null)
    .sort(compareLapDurations)[0] ?? null;
}

export function compareLapDurations(left: DriverLapSummary, right: DriverLapSummary) {
  return (left.lapDuration ?? Number.POSITIVE_INFINITY) - (right.lapDuration ?? Number.POSITIVE_INFINITY);
}

export function formatLapOption(lap: DriverLapSummary) {
  const tags = [
    `Lap ${lap.lapNumber}`,
    formatLapTime(lap.lapDuration),
    lap.isPitLap ? "pit lap" : null,
    lap.isPitOutLap ? "out lap" : null,
    lap.telemetrySampleCount > 0 ? "cached telemetry" : "telemetry on demand"
  ].filter((tag): tag is string => Boolean(tag));

  return tags.join(" • ");
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected frontend error.";
}
