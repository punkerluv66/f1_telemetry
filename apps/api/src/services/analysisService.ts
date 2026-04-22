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

  if (cache) {
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
  const normalizedTarget = normalizeTelemetry(targetLap.telemetryPoints);
  const commonDistance = Math.min(
    normalizedReference[normalizedReference.length - 1]?.distanceM ?? 0,
    normalizedTarget[normalizedTarget.length - 1]?.distanceM ?? 0
  );

  const referenceAligned = alignTelemetry({
    points: normalizedReference,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance
  });
  const targetAligned = alignTelemetry({
    points: normalizedTarget,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance
  });
  const deltaPoints = referenceAligned.map((point, index) => ({
    distanceM: point.distanceM,
    deltaMs: round(targetAligned[index].timeOffsetMs - point.timeOffsetMs)
  }));

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
      smoothingWindow: params.smoothingWindow
    },
    referenceLap: buildLapPayload(referenceLap, referenceAligned),
    targetLap: buildLapPayload(targetLap, targetAligned),
    delta: {
      points: deltaPoints,
      summary: summarizeDelta(deltaPoints, referenceLap.id, targetLap.id)
    }
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

    if (previousCarTimestamp !== null) {
      const deltaSeconds = (timestampMs - previousCarTimestamp) / 1000;
      integratedDistance += Math.max(0, (sortedCarData[index - 1].speed / 3.6) * deltaSeconds);
    }

    previousCarTimestamp = timestampMs;

    const locationState = interpolateLocationState(locationTimeline, timestampMs);
    const distanceM = Math.max(
      previousComputedDistance,
      locationState?.distanceM ?? integratedDistance
    );
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

function normalizeTelemetry(points: TelemetryPoint[]): ComparablePoint[] {
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

  return normalized;
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
  alignedPoints: AlignedPoint[]
) {
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
    points: alignedPoints,
    summary: {
      topSpeedKph: round(Math.max(...alignedPoints.map((point) => point.speedKph))),
      averageSpeedKph: round(average(alignedPoints.map((point) => point.speedKph))),
      averageThrottlePct: round(average(alignedPoints.map((point) => point.throttlePct))),
      peakBrakePct: round(Math.max(...alignedPoints.map((point) => point.brakePct))),
      lapTimeMs: round(alignedPoints[alignedPoints.length - 1]?.timeOffsetMs ?? 0)
    },
    events: detectBrakingZones(alignedPoints)
  };
}

function detectBrakingZones(points: AlignedPoint[]) {
  const events: Array<{
    label: string;
    startDistanceM: number;
    peakDistanceM: number;
    peakBrakePct: number;
    throttlePickupM: number;
  }> = [];

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

  return events.slice(0, 8);
}

function summarizeDelta(
  deltaPoints: Array<{
    distanceM: number;
    deltaMs: number;
  }>,
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
