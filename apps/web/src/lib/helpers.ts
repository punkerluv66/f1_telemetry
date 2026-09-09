import type {
  DriverLapSummary,
  DriverSessionSummary,
  ImportedSessionOverview,
} from "../types";
import { formatLapTime } from "./formatters";

export function getDriverById(
  overview: ImportedSessionOverview,
  driverId: number | null,
) {
  if (driverId === null) {
    return null;
  }

  return (
    overview.driverSummaries.find((driver) => driver.id === driverId) ?? null
  );
}

export function getPreferredLapId(
  driver: DriverSessionSummary | null,
  currentLapId: number | null,
) {
  if (!driver) {
    return null;
  }

  if (
    currentLapId &&
    driver.laps.some(
      (lap) =>
        lap.id === currentLapId &&
        lap.lapDuration !== null &&
        lap.lapDuration > 0 &&
        !lap.isPitLap &&
        !lap.isPitOutLap,
    )
  ) {
    return currentLapId;
  }

  return getPreferredLap(driver)?.id ?? null;
}

export function getPreferredLap(driver: DriverSessionSummary) {
  const cleanTimedLap = driver.laps
    .filter(
      (lap) =>
        lap.lapDuration !== null &&
        lap.lapDuration > 0 &&
        !lap.isPitOutLap &&
        !lap.isPitLap,
    )
    .sort(compareLapDurations)[0];

  if (cleanTimedLap) {
    return cleanTimedLap;
  }

  return null;
}

export function compareLapDurations(
  left: DriverLapSummary,
  right: DriverLapSummary,
) {
  return (
    (left.lapDuration ?? Number.POSITIVE_INFINITY) -
    (right.lapDuration ?? Number.POSITIVE_INFINITY)
  );
}

export function formatLapOption(lap: DriverLapSummary) {
  let tyreIcon = "";
  switch (lap.tyreCompound?.toUpperCase()) {
    case "SOFT":
      tyreIcon = "🔴 S";
      break;
    case "MEDIUM":
      tyreIcon = "🟡 M";
      break;
    case "HARD":
      tyreIcon = "⚪ H";
      break;
    case "INTERMEDIATE":
      tyreIcon = "🟢 I";
      break;
    case "WET":
      tyreIcon = "🔵 W";
      break;
    default:
      tyreIcon = lap.tyreCompound ? `🔘 ${lap.tyreCompound[0]}` : "";
  }

  const ageStr =
    lap.tyreAge !== undefined && lap.tyreAge !== null
      ? `(${lap.tyreAge} laps old)`
      : "";
  const tyreInfo = tyreIcon ? `${tyreIcon} ${ageStr}`.trim() : null;

  const tags = [
    `Lap ${lap.lapNumber}`,
    formatLapTime(lap.lapDuration),
    tyreInfo,
    lap.isPitLap ? "pit lap" : null,
    lap.isPitOutLap ? "out lap" : null,
    lap.telemetrySampleCount > 0 ? "cached telemetry" : "telemetry on demand",
  ].filter((tag): tag is string => Boolean(tag));

  return tags.join(" • ");
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected frontend error.";
}
