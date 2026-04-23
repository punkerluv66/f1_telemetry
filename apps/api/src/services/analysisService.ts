import type { Driver, Lap, Session, TelemetryPoint } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { getOpenF1CarData, getOpenF1Location } from "../lib/openf1.js";
import { getLapWithRelations, getNextDriverLap } from "./sessionImportService.js";

type LapContext = Lap & {
  driver: Driver;
  session: Session;
};

type ComparablePoint = {
  distanceM: number;
  timeOffsetMs: number;
  speedKph: number;
  throttlePct: number;
  brakePct: number;
  gear: number | null;
  rpm: number | null;
  x: number | null;
  y: number | null;
};

type AlignedPoint = ComparablePoint;

type NormalizedTelemetry = {
  points: ComparablePoint[];
  rawLapLengthM: number;
  normalizedLapLengthM: number;
  scaleFactor: number;
  firstSampleOffsetMs: number;
};

type BrakingZone = {
  label: string;
  startDistanceM: number;
  peakDistanceM: number;
  peakBrakePct: number;
  throttlePickupM: number;
};

type LapPayload = {
  id: number;
  lapNumber: number;
  lapDuration: number | null;
  telemetryImportedAt: Date | null;
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
  sectors: {
    sector1Ms: number | null;
    sector2Ms: number | null;
    sector3Ms: number | null;
  };
  tyre: {
    compound: string | null;
    age: number | null;
    stint: number | null;
  };
  points: AlignedPoint[];
  distance: {
    rawLapLengthM: number;
    normalizedLapLengthM: number;
    scaleFactor: number;
    firstSampleOffsetMs: number;
  };
  events: BrakingZone[];
};

type DeltaPoint = {
  distanceM: number;
  deltaMs: number;
};

const COMPARISON_PAYLOAD_VERSION = 3;
const DISTANCE_NORMALIZATION_VERSION = 2;
const DISTANCE_NORMALIZATION_MODE = "integrated-distance-scaled";

export async function ensureLapTelemetryImported(lapId: number) {
  const lap = await getLapWithRelations(lapId);
  const pointCount = await prisma.telemetryPoint.count({
    where: {
      lapId
    }
  });

  if (lap.telemetryImportedAt && pointCount > 0) {
    return lap;
  }

  await importLapTelemetry(lap);
  return getLapWithRelations(lapId);
}

async function importLapTelemetry(lap: LapContext) {
  const nextLap = await getNextDriverLap(lap);
  const fallbackDurationMs = Math.max(25_000, Math.round((lap.lapDuration ?? 95) * 1000 + 2_000));
  const endTime = nextLap?.dateStart ?? new Date(lap.dateStart.getTime() + fallbackDurationMs);

  const [carData, locationData] = await Promise.all([
    getOpenF1CarData({
      sessionKey: lap.sessionKey,
      driverNumber: lap.driverNumber,
      dateFrom: lap.dateStart.toISOString(),
      dateTo: endTime.toISOString()
    }),
    getOpenF1Location({
      sessionKey: lap.sessionKey,
      driverNumber: lap.driverNumber,
      dateFrom: lap.dateStart.toISOString(),
      dateTo: endTime.toISOString()
    })
  ]);

  if (carData.length < 2) {
    await prisma.lap.update({
      where: {
        id: lap.id
      },
      data: {
        telemetryStatus: "failed",
        telemetryMessage: "OpenF1 returned too few car_data points for this lap."
      }
    });

    throw new Error(`OpenF1 returned too few telemetry samples for lap ${lap.id}.`);
  }

  const points = buildTelemetryPoints({
    lap,
    carData,
    locationData
  });

  await prisma.$transaction([
    prisma.telemetryPoint.deleteMany({
      where: {
        lapId: lap.id
      }
    }),
    prisma.telemetryPoint.createMany({
      data: points
    }),
    prisma.lap.update({
      where: {
        id: lap.id
      },
      data: {
        telemetryImportedAt: new Date(),
        telemetryStatus: "imported",
        telemetryMessage: `Imported ${points.length} telemetry samples.`
      }
    })
  ]);
}

export async function compareLaps(params: {
  sessionId: number;
  referenceLapId: number;
  targetLapId: number;
  distanceStep: number;
  smoothingWindow: number;
}) {
  const cache = await prisma.comparisonCache.findUnique({
    where: {
      referenceLapId_targetLapId_distanceStep_smoothingWindow: {
        referenceLapId: params.referenceLapId,
        targetLapId: params.targetLapId,
        distanceStep: params.distanceStep,
        smoothingWindow: params.smoothingWindow
      }
    }
  });

  if (cache && isComparisonCacheCompatible(cache.payload)) {
    return cache.payload;
  }

  await Promise.all([
    ensureLapTelemetryImported(params.referenceLapId),
    ensureLapTelemetryImported(params.targetLapId)
  ]);

  const [referenceLap, targetLap] = await Promise.all([
    prisma.lap.findUniqueOrThrow({
      where: {
        id: params.referenceLapId
      },
      include: {
        driver: true,
        session: true,
        telemetryPoints: {
          orderBy: {
            sampleTime: "asc"
          }
        }
      }
    }),
    prisma.lap.findUniqueOrThrow({
      where: {
        id: params.targetLapId
      },
      include: {
        driver: true,
        session: true,
        telemetryPoints: {
          orderBy: {
            sampleTime: "asc"
          }
        }
      }
    })
  ]);

  const normalizedReference = normalizeTelemetry(referenceLap.telemetryPoints);
  const normalizedTarget = normalizeTelemetry(targetLap.telemetryPoints, {
    scaleToDistanceM: normalizedReference.normalizedLapLengthM
  });
  const commonDistance = Math.min(
    normalizedReference.normalizedLapLengthM,
    normalizedTarget.normalizedLapLengthM
  );

  const referenceAligned = alignTelemetry({
    points: normalizedReference.points,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance
  });
  const targetAligned = alignTelemetry({
    points: normalizedTarget.points,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance
  });
  const deltaPoints: DeltaPoint[] = referenceAligned.map((point, index) => ({
    distanceM: point.distanceM,
    deltaMs: round(targetAligned[index].timeOffsetMs - point.timeOffsetMs)
  }));

  const referencePayload = buildLapPayload(referenceLap, referenceAligned, normalizedReference);
  const targetPayload = buildLapPayload(targetLap, targetAligned, normalizedTarget);
  const sectorAnalysis = buildSectorAnalysis({
    referenceLap,
    targetLap,
    referenceDriver: referencePayload.driver.acronym,
    targetDriver: targetPayload.driver.acronym
  });
  const cornerAnalysis = buildCornerAnalysis({
    referenceLap: referencePayload,
    targetLap: targetPayload,
    deltaPoints
  });
  const report = buildEngineerReport({
    session: referenceLap.session,
    referenceLap: referencePayload,
    targetLap: targetPayload,
    deltaPoints,
    sectorAnalysis,
    cornerAnalysis
  });

  const payload = {
    session: {
      id: referenceLap.session.id,
      sessionKey: referenceLap.session.sessionKey,
      grandPrix: referenceLap.session.countryName,
      circuit: referenceLap.session.circuitShortName,
      sessionName: referenceLap.session.sessionName,
      year: referenceLap.session.year
    },
    settings: {
      distanceStep: params.distanceStep,
      smoothingWindow: params.smoothingWindow,
      payloadVersion: COMPARISON_PAYLOAD_VERSION,
      normalizationMode: DISTANCE_NORMALIZATION_MODE,
      normalizationVersion: DISTANCE_NORMALIZATION_VERSION
    },
    referenceLap: referencePayload,
    targetLap: targetPayload,
    delta: {
      points: deltaPoints,
      summary: summarizeDelta(deltaPoints, referenceLap.id, targetLap.id)
    },
    sectorAnalysis,
    cornerAnalysis,
    report
  };

  await prisma.comparisonCache.upsert({
    where: {
      referenceLapId_targetLapId_distanceStep_smoothingWindow: {
        referenceLapId: params.referenceLapId,
        targetLapId: params.targetLapId,
        distanceStep: params.distanceStep,
        smoothingWindow: params.smoothingWindow
      }
    },
    update: {
      payload
    },
    create: {
      sessionId: params.sessionId,
      referenceLapId: params.referenceLapId,
      targetLapId: params.targetLapId,
      distanceStep: params.distanceStep,
      smoothingWindow: params.smoothingWindow,
      payload
    }
  });

  return payload;
}

function buildTelemetryPoints(input: {
  lap: LapContext;
  carData: Awaited<ReturnType<typeof getOpenF1CarData>>;
  locationData: Awaited<ReturnType<typeof getOpenF1Location>>;
}) {
  const lapStartMs = input.lap.dateStart.getTime();
  const sortedCarData = [...input.carData].sort(compareByDate);
  const sortedLocation = [...input.locationData].sort(compareByDate);
  const locationTimeline = buildLocationTimeline(sortedLocation);

  let integratedDistance = 0;
  let previousCarTimestamp: number | null = null;
  let previousComputedDistance = 0;
  const points: Array<{
    lapId: number;
    sessionId: number;
    driverId: number;
    sampleTime: Date;
    timeOffsetMs: number;
    distanceM: number;
    relativeDistance: number;
    speedKph: number;
    throttlePct: number;
    brakePct: number;
    rpm: number | null;
    gear: number | null;
    drs: number | null;
    x: number | null;
    y: number | null;
    z: number | null;
  }> = [];

  for (const [index, sample] of sortedCarData.entries()) {
    const timestampMs = new Date(sample.date).getTime();

    if (previousCarTimestamp === null) {
      const initialOffsetMs = timestampMs - lapStartMs;
      if (initialOffsetMs > 0) {
        integratedDistance = (sample.speed / 3.6) * (initialOffsetMs / 1000);
      }
    } else {
      const deltaSeconds = (timestampMs - previousCarTimestamp) / 1000;
      const prevSpeed = sortedCarData[index - 1].speed;
      const avgSpeed = (prevSpeed + sample.speed) / 2;
      integratedDistance += Math.max(0, (avgSpeed / 3.6) * deltaSeconds);
    }

    previousCarTimestamp = timestampMs;

    const locationState = interpolateLocationState(locationTimeline, timestampMs);
    const distanceM = Math.max(previousComputedDistance, integratedDistance);
    previousComputedDistance = distanceM;

    points.push({
      lapId: input.lap.id,
      sessionId: input.lap.sessionId,
      driverId: input.lap.driverId,
      sampleTime: new Date(sample.date),
      timeOffsetMs: round(timestampMs - lapStartMs),
      distanceM: round(distanceM),
      relativeDistance: 0,
      speedKph: round(sample.speed),
      throttlePct: round(sample.throttle),
      brakePct: round(sample.brake),
      rpm: sample.rpm,
      gear: sample.n_gear,
      drs: sample.drs,
      x: locationState?.x ?? null,
      y: locationState?.y ?? null,
      z: locationState?.z ?? null
    });
  }

  const lapLength = Math.max(points[points.length - 1]?.distanceM ?? 1, 1);

  return points.map((point) => ({
    ...point,
    relativeDistance: round(point.distanceM / lapLength)
  }));
}

function buildLocationTimeline(locationData: Awaited<ReturnType<typeof getOpenF1Location>>) {
  const timeline: Array<{
    timestampMs: number;
    distanceM: number;
    x: number;
    y: number;
    z: number;
  }> = [];

  let cumulativeDistance = 0;

  locationData.forEach((point, index) => {
    if (index > 0) {
      const previous = locationData[index - 1];
      const rawStep = distance3d(previous, point);
      cumulativeDistance += Math.min(rawStep, 120);
    }

    timeline.push({
      timestampMs: new Date(point.date).getTime(),
      distanceM: round(cumulativeDistance),
      x: point.x,
      y: point.y,
      z: point.z
    });
  });

  return timeline;
}

function interpolateLocationState(
  timeline: Array<{
    timestampMs: number;
    distanceM: number;
    x: number;
    y: number;
    z: number;
  }>,
  timestampMs: number
) {
  if (timeline.length === 0) {
    return null;
  }

  if (timestampMs <= timeline[0].timestampMs) {
    return timeline[0];
  }

  if (timestampMs >= timeline[timeline.length - 1].timestampMs) {
    return timeline[timeline.length - 1];
  }

  let leftIndex = 0;

  while (leftIndex < timeline.length - 2 && timeline[leftIndex + 1].timestampMs < timestampMs) {
    leftIndex += 1;
  }

  const left = timeline[leftIndex];
  const right = timeline[leftIndex + 1];
  const ratio =
    left.timestampMs === right.timestampMs
      ? 0
      : (timestampMs - left.timestampMs) / (right.timestampMs - left.timestampMs);

  return {
    timestampMs,
    distanceM: round(interpolate(left.distanceM, right.distanceM, ratio)),
    x: round(interpolate(left.x, right.x, ratio)),
    y: round(interpolate(left.y, right.y, ratio)),
    z: round(interpolate(left.z, right.z, ratio))
  };
}

function normalizeTelemetry(
  points: TelemetryPoint[],
  options?: {
    scaleToDistanceM?: number;
  }
): NormalizedTelemetry {
  const normalized: ComparablePoint[] = [];
  let lastDistance = 0;

  for (const point of points) {
    const distanceM = Math.max(lastDistance, point.distanceM);
    lastDistance = distanceM;
    const current: ComparablePoint = {
      distanceM,
      timeOffsetMs: point.timeOffsetMs,
      speedKph: point.speedKph,
      throttlePct: point.throttlePct,
      brakePct: point.brakePct,
      gear: point.gear,
      rpm: point.rpm,
      x: point.x,
      y: point.y
    };

    if (normalized.length > 0 && Math.abs(normalized[normalized.length - 1].distanceM - distanceM) < 0.001) {
      normalized[normalized.length - 1] = current;
      continue;
    }

    normalized.push(current);
  }

  const rawLapLengthM = normalized[normalized.length - 1]?.distanceM ?? 0;
  const requestedDistance =
    options?.scaleToDistanceM && options.scaleToDistanceM > 0 ? options.scaleToDistanceM : rawLapLengthM;
  const rawScaleFactor = rawLapLengthM > 0 ? requestedDistance / rawLapLengthM : 1;
  const scaleFactor =
    Number.isFinite(rawScaleFactor) && rawScaleFactor > 0 ? rawScaleFactor : 1;
  const scaledPoints = deduplicateComparablePoints(
    normalized.map((point) => ({
      ...point,
      distanceM: round(point.distanceM * scaleFactor)
    }))
  );

  return {
    points: scaledPoints,
    rawLapLengthM: round(rawLapLengthM),
    normalizedLapLengthM: round(scaledPoints[scaledPoints.length - 1]?.distanceM ?? 0),
    scaleFactor: round(scaleFactor),
    firstSampleOffsetMs: round(normalized[0]?.timeOffsetMs ?? 0)
  };
}

function alignTelemetry(params: {
  points: ComparablePoint[];
  distanceStep: number;
  smoothingWindow: number;
  maxDistance: number;
}) {
  const smoothed = smoothComparablePoints(params.points, params.smoothingWindow);
  const aligned: AlignedPoint[] = [];
  let leftIndex = 0;

  for (let distance = 0; distance <= params.maxDistance; distance += params.distanceStep) {
    while (leftIndex < smoothed.length - 2 && smoothed[leftIndex + 1].distanceM < distance) {
      leftIndex += 1;
    }

    const left = smoothed[leftIndex];
    const right = smoothed[Math.min(smoothed.length - 1, leftIndex + 1)];

    if (left.distanceM === right.distanceM) {
      aligned.push({
        ...left,
        distanceM: round(distance)
      });
      continue;
    }

    const ratio = (distance - left.distanceM) / (right.distanceM - left.distanceM);

    aligned.push({
      distanceM: round(distance),
      timeOffsetMs: round(interpolate(left.timeOffsetMs, right.timeOffsetMs, ratio)),
      speedKph: round(interpolate(left.speedKph, right.speedKph, ratio)),
      throttlePct: round(interpolate(left.throttlePct, right.throttlePct, ratio)),
      brakePct: round(interpolate(left.brakePct, right.brakePct, ratio)),
      gear: roundNullable(interpolateNullable(left.gear, right.gear, ratio)),
      rpm: roundNullable(interpolateNullable(left.rpm, right.rpm, ratio)),
      x: roundNullable(interpolateNullable(left.x, right.x, ratio)),
      y: roundNullable(interpolateNullable(left.y, right.y, ratio))
    });
  }

  return aligned;
}

function smoothComparablePoints(points: ComparablePoint[], windowSize: number) {
  const radius = Math.max(0, Math.floor(windowSize / 2));

  return points.map((point, index) => {
    let speedSum = 0;
    let throttleSum = 0;
    let brakeSum = 0;
    let count = 0;

    for (
      let cursor = Math.max(0, index - radius);
      cursor <= Math.min(points.length - 1, index + radius);
      cursor += 1
    ) {
      speedSum += points[cursor].speedKph;
      throttleSum += points[cursor].throttlePct;
      brakeSum += points[cursor].brakePct;
      count += 1;
    }

    return {
      ...point,
      speedKph: round(speedSum / count),
      throttlePct: round(throttleSum / count),
      brakePct: round(brakeSum / count)
    };
  });
}

function buildLapPayload(
  lap: Lap & {
    driver: Driver;
    telemetryPoints: TelemetryPoint[];
  },
  alignedPoints: AlignedPoint[],
  normalizedTelemetry: NormalizedTelemetry
): LapPayload {
  return {
    id: lap.id,
    lapNumber: lap.lapNumber,
    lapDuration: lap.lapDuration,
    telemetryImportedAt: lap.telemetryImportedAt,
    driver: {
      id: lap.driver.id,
      driverNumber: lap.driver.driverNumber,
      acronym: lap.driver.acronym,
      fullName: lap.driver.fullName,
      teamName: lap.driver.teamName,
      color: lap.driver.teamColour ? `#${lap.driver.teamColour}` : "#1d4ed8"
    },
    summary: {
      topSpeedKph: round(Math.max(...alignedPoints.map((point) => point.speedKph))),
      averageSpeedKph: round(average(alignedPoints.map((point) => point.speedKph))),
      averageThrottlePct: round(average(alignedPoints.map((point) => point.throttlePct))),
      peakBrakePct: round(Math.max(...alignedPoints.map((point) => point.brakePct))),
      lapTimeMs: lap.lapDuration !== null ? Math.round(lap.lapDuration * 1000) : round(alignedPoints[alignedPoints.length - 1]?.timeOffsetMs ?? 0)
    },
    sectors: {
      sector1Ms: toMilliseconds(lap.durationSector1),
      sector2Ms: toMilliseconds(lap.durationSector2),
      sector3Ms: toMilliseconds(lap.durationSector3)
    },
    tyre: {
      compound: lap.tyreCompound,
      age: lap.tyreAge,
      stint: lap.stint
    },
    points: alignedPoints,
    distance: {
      rawLapLengthM: normalizedTelemetry.rawLapLengthM,
      normalizedLapLengthM: normalizedTelemetry.normalizedLapLengthM,
      scaleFactor: normalizedTelemetry.scaleFactor,
      firstSampleOffsetMs: normalizedTelemetry.firstSampleOffsetMs
    },
    events: detectBrakingZones(alignedPoints)
  };
}

function deduplicateComparablePoints(points: ComparablePoint[]) {
  const deduplicated: ComparablePoint[] = [];

  for (const point of points) {
    if (
      deduplicated.length > 0 &&
      Math.abs(deduplicated[deduplicated.length - 1].distanceM - point.distanceM) < 0.001
    ) {
      deduplicated[deduplicated.length - 1] = point;
      continue;
    }

    deduplicated.push(point);
  }

  return deduplicated;
}

function buildSectorAnalysis(params: {
  referenceLap: Lap & {
    driver: Driver;
  };
  targetLap: Lap & {
    driver: Driver;
  };
  referenceDriver: string;
  targetDriver: string;
}) {
  const sectors = [
    {
      label: "Sector 1",
      referenceMs: toMilliseconds(params.referenceLap.durationSector1),
      targetMs: toMilliseconds(params.targetLap.durationSector1)
    },
    {
      label: "Sector 2",
      referenceMs: toMilliseconds(params.referenceLap.durationSector2),
      targetMs: toMilliseconds(params.targetLap.durationSector2)
    },
    {
      label: "Sector 3",
      referenceMs: toMilliseconds(params.referenceLap.durationSector3),
      targetMs: toMilliseconds(params.targetLap.durationSector3)
    }
  ].map((sector) => {
    const deltaMs =
      sector.referenceMs === null || sector.targetMs === null
        ? null
        : round(sector.targetMs - sector.referenceMs);

    return {
      ...sector,
      deltaMs,
      winner:
        deltaMs === null
          ? "unavailable"
          : deltaMs < -0.5
            ? params.targetDriver
            : deltaMs > 0.5
              ? params.referenceDriver
              : "Even"
    };
  });

  const strongestSector = [...sectors]
    .filter((sector) => sector.deltaMs !== null)
    .sort((left, right) => Math.abs(right.deltaMs ?? 0) - Math.abs(left.deltaMs ?? 0))[0] ?? null;

  return {
    sectors,
    summary: {
      strongestSectorLabel: strongestSector?.label ?? null,
      strongestSectorWinner: strongestSector?.winner ?? null,
      strongestSectorDeltaMs: strongestSector?.deltaMs ?? null,
      targetBetterCount: sectors.filter((sector) => sector.winner === params.targetDriver).length,
      referenceBetterCount: sectors.filter((sector) => sector.winner === params.referenceDriver).length
    }
  };
}

function buildCornerAnalysis(params: {
  referenceLap: LapPayload;
  targetLap: LapPayload;
  deltaPoints: DeltaPoint[];
}) {
  const mergedCorners = mergeCornerEvents(params.referenceLap.events, params.targetLap.events);
  const corners = mergedCorners.map((corner, index) => {
    const referenceMetrics = summarizeCornerWindow(
      params.referenceLap.points,
      corner.entryDistanceM,
      corner.peakDistanceM,
      corner.exitDistanceM
    );
    const targetMetrics = summarizeCornerWindow(
      params.targetLap.points,
      corner.entryDistanceM,
      corner.peakDistanceM,
      corner.exitDistanceM
    );
    const entryDeltaMs = sampleDeltaAtDistance(params.deltaPoints, corner.entryDistanceM);
    const apexDeltaMs = sampleDeltaAtDistance(params.deltaPoints, corner.peakDistanceM);
    const exitDeltaMs = sampleDeltaAtDistance(params.deltaPoints, corner.exitDistanceM);
    const phaseDeltaMs = round(exitDeltaMs - entryDeltaMs);
    const fasterDriver =
      phaseDeltaMs < -15
        ? params.targetLap.driver.acronym
        : phaseDeltaMs > 15
          ? params.referenceLap.driver.acronym
          : "Even";

    return {
      key: `corner-${index + 1}`,
      label: `Corner ${index + 1}`,
      distanceM: corner.peakDistanceM,
      entryDistanceM: corner.entryDistanceM,
      exitDistanceM: corner.exitDistanceM,
      reference: referenceMetrics,
      target: targetMetrics,
      entryDeltaMs,
      apexDeltaMs,
      exitDeltaMs,
      phaseDeltaMs,
      fasterDriver
    };
  });

  const biggestTargetGain = [...corners].sort((left, right) => left.phaseDeltaMs - right.phaseDeltaMs)[0] ?? null;
  const biggestReferenceGain = [...corners].sort((left, right) => right.phaseDeltaMs - left.phaseDeltaMs)[0] ?? null;

  return {
    corners,
    summary: {
      targetBetterCorners: corners.filter((corner) => corner.fasterDriver === params.targetLap.driver.acronym).length,
      referenceBetterCorners: corners.filter((corner) => corner.fasterDriver === params.referenceLap.driver.acronym).length,
      biggestTargetGainLabel: biggestTargetGain && biggestTargetGain.phaseDeltaMs < 0 ? biggestTargetGain.label : null,
      biggestTargetGainMs: biggestTargetGain && biggestTargetGain.phaseDeltaMs < 0 ? biggestTargetGain.phaseDeltaMs : null,
      biggestReferenceGainLabel: biggestReferenceGain && biggestReferenceGain.phaseDeltaMs > 0 ? biggestReferenceGain.label : null,
      biggestReferenceGainMs: biggestReferenceGain && biggestReferenceGain.phaseDeltaMs > 0 ? biggestReferenceGain.phaseDeltaMs : null
    }
  };
}

function buildEngineerReport(params: {
  session: Session;
  referenceLap: LapPayload;
  targetLap: LapPayload;
  deltaPoints: DeltaPoint[];
  sectorAnalysis: ReturnType<typeof buildSectorAnalysis>;
  cornerAnalysis: ReturnType<typeof buildCornerAnalysis>;
}) {
  const finalDeltaMs = params.deltaPoints[params.deltaPoints.length - 1]?.deltaMs ?? 0;
  const winner =
    finalDeltaMs < 0 ? params.targetLap.driver.acronym : params.referenceLap.driver.acronym;
  const winnerMarginMs = Math.abs(finalDeltaMs);
  const strongestSectors = [...params.sectorAnalysis.sectors]
    .filter((sector) => sector.deltaMs !== null)
    .sort((left, right) => Math.abs(right.deltaMs ?? 0) - Math.abs(left.deltaMs ?? 0))
    .slice(0, 3)
    .map((sector) => ({
      label: sector.label,
      winner: sector.winner,
      deltaMs: sector.deltaMs ?? 0,
      note:
        sector.winner === "Even"
          ? `${sector.label} is effectively matched between both laps.`
          : `${sector.winner} is quicker in ${sector.label} by ${formatDeltaMs(Math.abs(sector.deltaMs ?? 0))}.`
    }));
  const biggestLosses = [...params.cornerAnalysis.corners]
    .sort((left, right) => Math.abs(right.phaseDeltaMs) - Math.abs(left.phaseDeltaMs))
    .slice(0, 3)
    .map((corner) => ({
      label: corner.label,
      owner:
        corner.phaseDeltaMs < 0 ? params.referenceLap.driver.acronym : params.targetLap.driver.acronym,
      deltaMs: round(Math.abs(corner.phaseDeltaMs)),
      note:
        corner.phaseDeltaMs < 0
          ? `${params.targetLap.driver.acronym} gains ${formatDeltaMs(Math.abs(corner.phaseDeltaMs))} in ${corner.label}.`
          : `${params.referenceLap.driver.acronym} gains ${formatDeltaMs(Math.abs(corner.phaseDeltaMs))} in ${corner.label}.`
    }));
  const tyreNotes = buildTyreNotes(params.referenceLap, params.targetLap);
  const brakeNotes = buildBrakeNotes(
    params.cornerAnalysis,
    params.referenceLap.driver.acronym,
    params.targetLap.driver.acronym
  );
  const summary = [
    `${winner} finishes this comparison ${formatDeltaMs(winnerMarginMs)} ahead over the full lap.`,
    `${params.targetLap.driver.acronym} is better in ${params.cornerAnalysis.summary.targetBetterCorners} braking zones, ${params.referenceLap.driver.acronym} in ${params.cornerAnalysis.summary.referenceBetterCorners}.`,
    params.sectorAnalysis.summary.strongestSectorLabel && params.sectorAnalysis.summary.strongestSectorWinner
      ? `${params.sectorAnalysis.summary.strongestSectorLabel} is the biggest swing for ${params.sectorAnalysis.summary.strongestSectorWinner}.`
      : "Sector deltas are too close to call cleanly.",
    tyreNotes[0] ?? "Tyre metadata is limited for one or both laps."
  ];
  const headline = `${winner} holds the lap advantage in ${params.session.year} ${params.session.countryName} ${params.session.sessionName}.`;
  const exportMarkdown = buildEngineerReportMarkdown({
    headline,
    session: params.session,
    referenceLap: params.referenceLap,
    targetLap: params.targetLap,
    finalDeltaMs,
    summary,
    strongestSectors,
    biggestLosses,
    tyreNotes,
    brakeNotes
  });

  return {
    headline,
    summary,
    strongestSectors,
    biggestLosses,
    tyreNotes,
    brakeNotes,
    exportMarkdown
  };
}

function mergeCornerEvents(referenceEvents: BrakingZone[], targetEvents: BrakingZone[]) {
  const allEvents = [
    ...referenceEvents.map((event) => ({ ...event, source: "reference" })),
    ...targetEvents.map((event) => ({ ...event, source: "target" }))
  ].sort((left, right) => left.peakDistanceM - right.peakDistanceM);
  const merged: Array<{
    peakDistanceM: number;
    entryDistanceM: number;
    exitDistanceM: number;
    members: Array<typeof allEvents[number]>;
  }> = [];

  for (const event of allEvents) {
    const current = merged[merged.length - 1];

    if (current && Math.abs(current.peakDistanceM - event.peakDistanceM) <= 140) {
      current.members.push(event);
      current.peakDistanceM = round(average(current.members.map((member) => member.peakDistanceM)));
      current.entryDistanceM = round(Math.min(current.entryDistanceM, event.startDistanceM));
      current.exitDistanceM = round(Math.max(current.exitDistanceM, event.throttlePickupM));
      continue;
    }

    merged.push({
      peakDistanceM: event.peakDistanceM,
      entryDistanceM: event.startDistanceM,
      exitDistanceM: event.throttlePickupM,
      members: [event]
    });
  }

  return merged;
}

function summarizeCornerWindow(
  points: AlignedPoint[],
  entryDistanceM: number,
  peakDistanceM: number,
  exitDistanceM: number
) {
  const segment = points.filter(
    (point) => point.distanceM >= entryDistanceM && point.distanceM <= exitDistanceM
  );
  const fallbackSegment = segment.length > 0 ? segment : points;
  const entryPoint = findClosestPointByDistance(points, entryDistanceM);
  const apexPoint = [...fallbackSegment].sort((left, right) => left.speedKph - right.speedKph)[0] ?? entryPoint;
  const exitPoint = findClosestPointByDistance(points, exitDistanceM);

  return {
    entrySpeedKph: round(entryPoint.speedKph),
    apexSpeedKph: round(apexPoint.speedKph),
    exitSpeedKph: round(exitPoint.speedKph),
    peakBrakePct: round(Math.max(...fallbackSegment.map((point) => point.brakePct))),
    throttleAtExitPct: round(exitPoint.throttlePct),
    apexDistanceM: round(apexPoint.distanceM),
    peakDistanceM: round(peakDistanceM)
  };
}

function sampleDeltaAtDistance(deltaPoints: DeltaPoint[], distanceM: number) {
  return round(findClosestDeltaPoint(deltaPoints, distanceM).deltaMs);
}

function buildTyreNotes(referenceLap: LapPayload, targetLap: LapPayload) {
  const notes = [
    `${referenceLap.driver.acronym}: ${formatTyreLabel(referenceLap.tyre)}.`,
    `${targetLap.driver.acronym}: ${formatTyreLabel(targetLap.tyre)}.`
  ];
  const compoundGap =
    referenceLap.tyre.compound && targetLap.tyre.compound && referenceLap.tyre.compound !== targetLap.tyre.compound
      ? `Compound split: ${referenceLap.driver.acronym} on ${referenceLap.tyre.compound}, ${targetLap.driver.acronym} on ${targetLap.tyre.compound}.`
      : null;
  const ageGap =
    referenceLap.tyre.age !== null && targetLap.tyre.age !== null
      ? `${Math.abs(referenceLap.tyre.age - targetLap.tyre.age)} lap tyre-age gap between the selected laps.`
      : null;

  return [...notes, compoundGap, ageGap].filter((note): note is string => Boolean(note));
}

function buildBrakeNotes(
  cornerAnalysis: ReturnType<typeof buildCornerAnalysis>,
  referenceDriver: string,
  targetDriver: string
) {
  if (cornerAnalysis.corners.length === 0) {
    return ["Not enough braking windows to extract notes."];
  }

  const biggestBrakeGap = [...cornerAnalysis.corners].sort((left, right) => {
    const leftGap = Math.abs(left.reference.peakBrakePct - left.target.peakBrakePct);
    const rightGap = Math.abs(right.reference.peakBrakePct - right.target.peakBrakePct);
    return rightGap - leftGap;
  })[0];
  const biggestExitGap = [...cornerAnalysis.corners].sort((left, right) => {
    const leftGap = Math.abs(left.reference.exitSpeedKph - left.target.exitSpeedKph);
    const rightGap = Math.abs(right.reference.exitSpeedKph - right.target.exitSpeedKph);
    return rightGap - leftGap;
  })[0];

  const brakeLeader =
    biggestBrakeGap.reference.peakBrakePct > biggestBrakeGap.target.peakBrakePct ? referenceDriver : targetDriver;
  const exitLeader =
    biggestExitGap.reference.exitSpeedKph > biggestExitGap.target.exitSpeedKph ? referenceDriver : targetDriver;

  return [
    `${brakeLeader} shows the heavier brake peak in ${biggestBrakeGap.label}.`,
    `${exitLeader} carries the stronger exit speed in ${biggestExitGap.label}.`,
    cornerAnalysis.summary.biggestTargetGainLabel
      ? `${targetDriver}'s best corner phase is ${cornerAnalysis.summary.biggestTargetGainLabel}.`
      : `${targetDriver} does not show a decisive corner-phase gain.`,
    cornerAnalysis.summary.biggestReferenceGainLabel
      ? `${referenceDriver}'s best corner phase is ${cornerAnalysis.summary.biggestReferenceGainLabel}.`
      : `${referenceDriver} does not show a decisive corner-phase gain.`
  ];
}

function buildEngineerReportMarkdown(input: {
  headline: string;
  session: Session;
  referenceLap: LapPayload;
  targetLap: LapPayload;
  finalDeltaMs: number;
  summary: string[];
  strongestSectors: Array<{
    label: string;
    winner: string;
    deltaMs: number;
    note: string;
  }>;
  biggestLosses: Array<{
    label: string;
    owner: string;
    deltaMs: number;
    note: string;
  }>;
  tyreNotes: string[];
  brakeNotes: string[];
}) {
  return [
    `# ${input.headline}`,
    "",
    `Session: ${input.session.year} ${input.session.countryName} ${input.session.sessionName}`,
    `Reference lap: ${input.referenceLap.driver.acronym} L${input.referenceLap.lapNumber} (${formatLapTimeSeconds(input.referenceLap.lapDuration)})`,
    `Target lap: ${input.targetLap.driver.acronym} L${input.targetLap.lapNumber} (${formatLapTimeSeconds(input.targetLap.lapDuration)})`,
    `Final delta: ${formatSignedMilliseconds(input.finalDeltaMs)}`,
    "",
    "## Summary",
    ...input.summary.map((line) => `- ${line}`),
    "",
    "## Strongest Sectors",
    ...input.strongestSectors.map((item) => `- ${item.note}`),
    "",
    "## Biggest Time Swings",
    ...input.biggestLosses.map((item) => `- ${item.note}`),
    "",
    "## Tyre Notes",
    ...input.tyreNotes.map((line) => `- ${line}`),
    "",
    "## Brake Notes",
    ...input.brakeNotes.map((line) => `- ${line}`)
  ].join("\n");
}

function isComparisonCacheCompatible(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("settings" in payload)) {
    return false;
  }

  const settings = (
    payload as {
      settings?: {
        normalizationVersion?: unknown;
        payloadVersion?: unknown;
      };
    }
  ).settings;

  return (
    settings?.normalizationVersion === DISTANCE_NORMALIZATION_VERSION &&
    settings?.payloadVersion === COMPARISON_PAYLOAD_VERSION
  );
}

function detectBrakingZones(points: AlignedPoint[]): BrakingZone[] {
  const events: BrakingZone[] = [];

  let current:
    | {
        startDistanceM: number;
        peakDistanceM: number;
        peakBrakePct: number;
      }
    | null = null;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];

    if (!current && point.brakePct >= 18 && previous.brakePct < 18) {
      current = {
        startDistanceM: point.distanceM,
        peakDistanceM: point.distanceM,
        peakBrakePct: point.brakePct
      };
    }

    if (current) {
      if (point.brakePct > current.peakBrakePct) {
        current.peakBrakePct = point.brakePct;
        current.peakDistanceM = point.distanceM;
      }

      if (point.brakePct <= 8 && previous.brakePct > 8) {
        const throttlePickup =
          points.slice(index).find((candidate) => candidate.throttlePct >= 85)?.distanceM ??
          point.distanceM;

        events.push({
          label: `Zone ${events.length + 1}`,
          startDistanceM: round(current.startDistanceM),
          peakDistanceM: round(current.peakDistanceM),
          peakBrakePct: round(current.peakBrakePct),
          throttlePickupM: round(throttlePickup)
        });

        current = null;
      }
    }
  }

  return events;
}

function summarizeDelta(
  deltaPoints: DeltaPoint[],
  referenceLapId: number,
  targetLapId: number
) {
  const finalDeltaMs = deltaPoints[deltaPoints.length - 1]?.deltaMs ?? 0;

  return {
    referenceLapId,
    targetLapId,
    finalDeltaMs: round(finalDeltaMs),
    bestTargetGainMs: round(Math.min(0, ...deltaPoints.map((point) => point.deltaMs))),
    biggestTargetLossMs: round(Math.max(0, ...deltaPoints.map((point) => point.deltaMs))),
    winnerLapId: finalDeltaMs < 0 ? targetLapId : referenceLapId
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function toMilliseconds(seconds: number | null) {
  return seconds === null ? null : round(seconds * 1000);
}

function findClosestPointByDistance(points: AlignedPoint[], distanceM: number) {
  let closest = points[0];
  let gap = Math.abs(points[0].distanceM - distanceM);

  for (let index = 1; index < points.length; index += 1) {
    const candidateGap = Math.abs(points[index].distanceM - distanceM);

    if (candidateGap < gap) {
      closest = points[index];
      gap = candidateGap;
    }
  }

  return closest;
}

function findClosestDeltaPoint(points: DeltaPoint[], distanceM: number) {
  let closest = points[0];
  let gap = Math.abs(points[0].distanceM - distanceM);

  for (let index = 1; index < points.length; index += 1) {
    const candidateGap = Math.abs(points[index].distanceM - distanceM);

    if (candidateGap < gap) {
      closest = points[index];
      gap = candidateGap;
    }
  }

  return closest;
}

function formatTyreLabel(tyre: LapPayload["tyre"]) {
  const compound = tyre.compound ?? "unknown compound";
  const age = tyre.age !== null ? `${tyre.age} laps old` : "age unknown";
  const stint = tyre.stint !== null ? `stint ${tyre.stint}` : "stint unknown";
  return `${compound}, ${age}, ${stint}`;
}

function formatDeltaMs(deltaMs: number) {
  return `${(deltaMs / 1000).toFixed(3)} s`;
}

function formatSignedMilliseconds(deltaMs: number) {
  return `${deltaMs > 0 ? "+" : ""}${(deltaMs / 1000).toFixed(3)} s`;
}

function formatLapTimeSeconds(seconds: number | null) {
  if (seconds === null) {
    return "N/A";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const remainingSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function compareByDate(left: { date: string }, right: { date: string }) {
  return new Date(left.date).getTime() - new Date(right.date).getTime();
}

function distance3d(
  left: {
    x: number;
    y: number;
    z: number;
  },
  right: {
    x: number;
    y: number;
    z: number;
  }
) {
  return Math.sqrt(
    (right.x - left.x) ** 2 +
      (right.y - left.y) ** 2 +
      (right.z - left.z) ** 2
  );
}

function interpolate(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function interpolateNullable(start: number | null, end: number | null, ratio: number) {
  if (start === null && end === null) {
    return null;
  }

  if (start === null) {
    return end;
  }

  if (end === null) {
    return start;
  }

  return interpolate(start, end, ratio);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value);
}
