export interface OpenF1SessionSearchResult {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  country_name: string;
  circuit_short_name: string;
  year: number;
}

export interface ImportedSessionSummary {
  id: number;
  sessionKey: number;
  sessionName: string;
  sessionType: string;
  circuitShortName: string;
  countryName: string;
  year: number;
  dateStart: string;
  _count: {
    drivers: number;
    laps: number;
  };
}

export interface DriverSummary {
  id: number;
  driverNumber: number;
  acronym: string;
  fullName: string;
  teamName: string;
  teamColour: string | null;
  headshotUrl?: string | null;
}

export interface DriverLapSummary {
  id: number;
  lapNumber: number;
  lapDuration: number | null;
  isPitOutLap: boolean;
  telemetryImportedAt: string | null;
  telemetryStatus: string;
  telemetrySampleCount: number;
  isPitLap: boolean;
  stint?: number | null;
  tyreCompound?: string | null;
  tyreAge?: number | null;
}

export interface DriverSessionResult {
  position: number | null;
  classificationLabel: string;
  status: "classified" | "dnf" | "dns" | "dsq" | "unavailable";
  points: number | null;
  numberOfLaps: number | null;
  officialDurationText: string | null;
  gapToLeaderText: string | null;
}

export interface DriverSessionStats {
  totalLaps: number;
  timedLaps: number;
  telemetryCachedLaps: number;
  bestLapSeconds: number | null;
  averageLapSeconds: number | null;
  pitStopCount: number;
}

export interface DriverPitStopSummary {
  id: number;
  lapNumber: number | null;
  date: string;
  laneDuration: number | null;
  stopDuration: number | null;
  pitDuration: number | null;
}

export interface DriverStintSummary {
  id: number;
  stintNumber: number;
  lapStart: number;
  lapEnd: number;
  compound: string | null;
  tyreAgeAtStart: number | null;
}

export interface DriverSessionSummary extends DriverSummary {
  headshotUrl: string | null;
  result: DriverSessionResult;
  stats: DriverSessionStats;
  pitStops: DriverPitStopSummary[];
  stints: DriverStintSummary[];
  laps: DriverLapSummary[];
}

export interface ImportedSessionOverview {
  id: number;
  sessionKey: number;
  sessionName: string;
  sessionType: string;
  circuitShortName: string;
  countryName: string;
  year: number;
  dateStart: string;
  driverSummaries: DriverSessionSummary[];
  defaultDriverPair: {
    leftDriverId: number | null;
    rightDriverId: number | null;
  };
}

export interface ChartPoint {
  distanceM: number;
  timeOffsetMs: number;
  speedKph: number;
  throttlePct: number;
  brakePct: number;
  gear: number | null;
  rpm: number | null;
  x: number | null;
  y: number | null;
}

export interface BrakingEvent {
  label: string;
  startDistanceM: number;
  peakDistanceM: number;
  peakBrakePct: number;
  throttlePickupM: number;
}

export interface SectorBreakdown {
  sector1Ms: number | null;
  sector2Ms: number | null;
  sector3Ms: number | null;
}

export interface LapDistanceSummary {
  rawLapLengthM: number;
  normalizedLapLengthM: number;
  scaleFactor: number;
  firstSampleOffsetMs: number;
}

export interface LapTyreSummary {
  compound: string | null;
  age: number | null;
  stint: number | null;
}

export interface LapAnalysis {
  id: number;
  lapNumber: number;
  lapDuration: number | null;
  telemetryImportedAt: string | null;
  driver: {
    id: number;
    driverNumber: number;
    acronym: string;
    fullName: string;
    teamName: string;
    color: string;
  };
  summary: {
    topSpeedKph: number;
    averageSpeedKph: number;
    averageThrottlePct: number;
    peakBrakePct: number;
    lapTimeMs: number;
  };
  sectors: SectorBreakdown;
  tyre: LapTyreSummary;
  points: ChartPoint[];
  distance: LapDistanceSummary;
  events: BrakingEvent[];
}

export interface SectorComparison {
  label: string;
  referenceMs: number | null;
  targetMs: number | null;
  deltaMs: number | null;
  winner: string;
}

export interface CornerMetrics {
  entrySpeedKph: number;
  apexSpeedKph: number;
  exitSpeedKph: number;
  peakBrakePct: number;
  throttleAtExitPct: number;
  apexDistanceM: number;
  peakDistanceM: number;
}

export interface CornerComparison {
  key: string;
  label: string;
  distanceM: number;
  entryDistanceM: number;
  exitDistanceM: number;
  reference: CornerMetrics;
  target: CornerMetrics;
  entryDeltaMs: number;
  apexDeltaMs: number;
  exitDeltaMs: number;
  phaseDeltaMs: number;
  fasterDriver: string;
}

export interface ReportItem {
  label: string;
  winner?: string;
  owner?: string;
  deltaMs: number;
  note: string;
}

export interface ComparisonResponse {
  session: {
    id: number;
    sessionKey: number;
    grandPrix: string;
    circuit: string;
    sessionName: string;
    year: number;
  };
  settings: {
    distanceStep: number;
    smoothingWindow: number;
    payloadVersion: number;
    normalizationMode: string;
    normalizationVersion: number;
  };
  referenceLap: LapAnalysis;
  targetLap: LapAnalysis;
  delta: {
    points: Array<{
      distanceM: number;
      deltaMs: number;
    }>;
    summary: {
      referenceLapId: number;
      targetLapId: number;
      finalDeltaMs: number;
      bestTargetGainMs: number;
      biggestTargetLossMs: number;
      winnerLapId: number;
    };
  };
  sectorAnalysis: {
    sectors: SectorComparison[];
    summary: {
      strongestSectorLabel: string | null;
      strongestSectorWinner: string | null;
      strongestSectorDeltaMs: number | null;
      targetBetterCount: number;
      referenceBetterCount: number;
    };
  };
  cornerAnalysis: {
    corners: CornerComparison[];
    summary: {
      targetBetterCorners: number;
      referenceBetterCorners: number;
      biggestTargetGainLabel: string | null;
      biggestTargetGainMs: number | null;
      biggestReferenceGainLabel: string | null;
      biggestReferenceGainMs: number | null;
    };
  };
  report: {
    headline: string;
    summary: string[];
    strongestSectors: ReportItem[];
    biggestLosses: ReportItem[];
    tyreNotes: string[];
    brakeNotes: string[];
    exportMarkdown: string;
  };
}
