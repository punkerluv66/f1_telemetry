import { runSessionTask } from "../lib/sessionQueue.js";
import { HttpError } from "../lib/errors.js";
import type { Driver, Lap, Session, TelemetryPoint } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { getOpenF1CarData, getOpenF1Location } from "../lib/openf1.js";
import { getLapWithRelations } from "./sessionImportService.js";

type LapContext = Lap & {
  driver: Driver;
  session: Session;
};

type ComparablePoint = {
  timingAnchor?: boolean;
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

const COMPARISON_PAYLOAD_VERSION = 9;
const TELEMETRY_VERSION = 3;
const telemetryImports = new Map<number, Promise<LapContext>>();
const DISTANCE_NORMALIZATION_VERSION = 4;

export function ensureLapTelemetryImported(lapId: number) {
  const existing = telemetryImports.get(lapId);
  if (existing) return existing;
  const task = ensureLapTelemetryImportedImpl(lapId).finally(() =>
    telemetryImports.delete(lapId),
  );
  telemetryImports.set(lapId, task);
  return task;
}
async function ensureLapTelemetryImportedImpl(lapId: number) {
  const lap = await getLapWithRelations(lapId);
  const pointCount = await prisma.telemetryPoint.count({
    where: {
      lapId,
    },
  });

  if (
    lap.telemetryImportedAt &&
    lap.telemetryVersion === TELEMETRY_VERSION &&
    pointCount > 1
  ) {
    return lap;
  }

  try {
    await importLapTelemetry(lap);
  } catch (error) {
    await prisma.lap.update({
      where: { id: lapId },
      data: {
        telemetryStatus: "failed",
        telemetryMessage:
          error instanceof Error ? error.message : "Telemetry import failed.",
      },
    });
    throw error;
  }
  return getLapWithRelations(lapId);
}

async function importLapTelemetry(lap: LapContext) {
  if (!lap.lapDuration || lap.lapDuration <= 0 || lap.isPitOutLap)
    throw new HttpError(422, "Select a complete timed lap without a pit exit.");
  const endTime = new Date(lap.dateStart.getTime() + lap.lapDuration * 1000);
  const dateFrom = new Date(lap.dateStart.getTime() - 1000).toISOString();
  const dateTo = new Date(endTime.getTime() + 1000).toISOString();
  const [carData, locationData] = await Promise.all([
    getOpenF1CarData({
      sessionKey: lap.sessionKey,
      driverNumber: lap.driverNumber,
      dateFrom,
      dateTo,
    }),
    getOpenF1Location({
      sessionKey: lap.sessionKey,
      driverNumber: lap.driverNumber,
      dateFrom,
      dateTo,
    }).catch(() => []),
  ]);

  if (carData.length < 2) {
    await prisma.lap.update({
      where: {
        id: lap.id,
      },
      data: {
        telemetryStatus: "failed",
        telemetryMessage:
          "OpenF1 returned too few car_data points for this lap.",
      },
    });

    throw new HttpError(
      422,
      `OpenF1 returned too few telemetry samples for lap ${lap.id}.`,
    );
  }

  const { points, quality } = buildTelemetryPoints({
    lap,
    carData,
    locationData,
  });

  await prisma.$transaction([
    prisma.comparisonCache.deleteMany({
      where: { OR: [{ referenceLapId: lap.id }, { targetLapId: lap.id }] },
    }),
    prisma.telemetryPoint.deleteMany({
      where: {
        lapId: lap.id,
      },
    }),
    prisma.telemetryPoint.createMany({
      data: points,
    }),
    prisma.lap.update({
      where: {
        id: lap.id,
      },
      data: {
        telemetryImportedAt: new Date(),
        telemetryVersion: TELEMETRY_VERSION,
        telemetryQuality: quality,
        telemetryStatus: "imported",
        telemetryMessage: `Imported ${points.length} telemetry samples.`,
      },
    }),
  ]);
}

type ComparisonParams = {
  sessionId: number;
  referenceLapId: number;
  targetLapId: number;
  distanceStep: number;
  smoothingWindow: number;
};
export type AnalysisStage = "queued" | "loading" | "calculating";
export async function compareLaps(
  params: ComparisonParams,
  onProgress?: (stage: AnalysisStage) => void,
) {
  onProgress?.("queued");
  const reference = await getLapWithRelations(params.referenceLapId);
  return runSessionTask(reference.sessionKey, () =>
    compareLapsImpl(params, onProgress),
  );
}
async function compareLapsImpl(
  params: ComparisonParams,
  onProgress?: (stage: AnalysisStage) => void,
) {
  const contexts = await Promise.all([
    getLapWithRelations(params.referenceLapId),
    getLapWithRelations(params.targetLapId),
  ]);
  if (contexts.some((lap) => lap.sessionId !== params.sessionId))
    throw new HttpError(400, "Both laps must belong to the selected session.");
  if (
    contexts.some(
      (lap) => !lap.lapDuration || lap.lapDuration <= 0 || lap.isPitOutLap,
    )
  )
    throw new HttpError(422, "Select complete timed laps without a pit exit.");
  const pitLap = await prisma.pitStop.findFirst({
    where: {
      sessionId: params.sessionId,
      OR: contexts.map((lap) => ({
        driverId: lap.driverId,
        lapNumber: lap.lapNumber,
      })),
    },
  });
  if (pitLap)
    throw new HttpError(
      422,
      "Pit-in laps cannot be compared. Select a clean lap.",
    );
  const cache = await prisma.comparisonCache.findUnique({
    where: {
      referenceLapId_targetLapId_distanceStep_smoothingWindow: {
        referenceLapId: params.referenceLapId,
        targetLapId: params.targetLapId,
        distanceStep: params.distanceStep,
        smoothingWindow: params.smoothingWindow,
      },
    },
  });

  if (cache && isComparisonCacheCompatible(cache.payload)) {
    return cache.payload;
  }

  onProgress?.("loading");
  await Promise.all([
    ensureLapTelemetryImported(params.referenceLapId),
    ensureLapTelemetryImported(params.targetLapId),
  ]);

  const [referenceLap, targetLap] = await Promise.all([
    prisma.lap.findUniqueOrThrow({
      where: {
        id: params.referenceLapId,
      },
      include: {
        driver: true,
        session: true,
        telemetryPoints: {
          orderBy: {
            sampleTime: "asc",
          },
        },
      },
    }),
    prisma.lap.findUniqueOrThrow({
      where: {
        id: params.targetLapId,
      },
      include: {
        driver: true,
        session: true,
        telemetryPoints: {
          orderBy: {
            sampleTime: "asc",
          },
        },
      },
    }),
  ]);

  onProgress?.("calculating");
  const {
    reference: normalizedReference,
    target: normalizedTarget,
    sectorAlignment,
  } = normalizeComparisonTelemetry(referenceLap, targetLap);
  const commonDistance = Math.min(
    normalizedReference.normalizedLapLengthM,
    normalizedTarget.normalizedLapLengthM,
  );

  const referenceAligned = alignTelemetry({
    points: normalizedReference.points,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance,
    anchorDistances: sectorAlignment.anchors.map((anchor) => anchor.distanceM),
  });
  const targetAligned = alignTelemetry({
    points: normalizedTarget.points,
    distanceStep: params.distanceStep,
    smoothingWindow: params.smoothingWindow,
    maxDistance: commonDistance,
    anchorDistances: sectorAlignment.anchors.map((anchor) => anchor.distanceM),
  });
  const deltaPoints: DeltaPoint[] = referenceAligned.map((point, index) => ({
    distanceM: point.distanceM,
    deltaMs: round(point.timeOffsetMs - targetAligned[index].timeOffsetMs),
  }));

  const miniSectors = buildMiniSectors(
    normalizedReference.points,
    normalizedTarget.points,
    commonDistance,
  );

  const referencePayload = buildLapPayload(
    referenceLap,
    referenceAligned,
    normalizedReference,
  );
  const targetPayload = buildLapPayload(
    targetLap,
    targetAligned,
    normalizedTarget,
  );
  const sectorAnalysis = buildSectorAnalysis({
    referenceLap,
    targetLap,
    referenceDriver: lapLabel(referencePayload),
    targetDriver: lapLabel(targetPayload),
  });
  const cornerAnalysis = buildCornerAnalysis({
    referenceLap: referencePayload,
    targetLap: targetPayload,
    deltaPoints,
  });
  const officialDeltaMs = round(
    ((referenceLap.lapDuration ?? 0) - (targetLap.lapDuration ?? 0)) * 1000,
  );
  const qualityWarnings = [
    "Distance is estimated from speed on a shared axis; positions and interior mini-sector times remain approximate.",
    ...(sectorAlignment.reason ? [sectorAlignment.reason] : []),
    ...(Math.abs(normalizedReference.rawLapLengthM / normalizedTarget.rawLapLengthM - 1) > 0.03
      ? [
          "Estimated lap lengths differ by more than 3%; local delta interpretation is uncertain.",
        ]
      : []),
    ...(!referenceLap.telemetryPoints.some((p) => p.x !== null) ||
    !targetLap.telemetryPoints.some((p) => p.x !== null)
      ? ["Location data is missing for at least one lap."]
      : []),
  ];
  const report = buildEngineerReport({
    session: referenceLap.session,
    referenceLap: referencePayload,
    targetLap: targetPayload,
    deltaPoints,
    sectorAnalysis,
    cornerAnalysis,
  });

  const payload = {
    session: {
      id: referenceLap.session.id,
      sessionKey: referenceLap.session.sessionKey,
      grandPrix: referenceLap.session.countryName,
      circuit: referenceLap.session.circuitShortName,
      sessionName: referenceLap.session.sessionName,
      year: referenceLap.session.year,
    },
    settings: {
      distanceStep: params.distanceStep,
      smoothingWindow: params.smoothingWindow,
      payloadVersion: COMPARISON_PAYLOAD_VERSION,
      deltaConvention: "reference-minus-target",
      normalizationMode: sectorAlignment.mode,
      normalizationVersion: DISTANCE_NORMALIZATION_VERSION,
    },
    referenceLap: referencePayload,
    targetLap: targetPayload,
    miniSectors,
    delta: {
      points: deltaPoints,
      summary: {
        ...summarizeDelta(deltaPoints, referenceLap.id, targetLap.id),
        officialDeltaMs,
      },
    },
    sectorAnalysis,
    cornerAnalysis,
    quality: {
      sectorAlignment,
      warnings: qualityWarnings,
      reference: referenceLap.telemetryQuality,
      target: targetLap.telemetryQuality,
    },
    report: {
      ...report,
      exportMarkdown:
        report.exportMarkdown +
        buildMiniSectorMarkdown(miniSectors, referencePayload, targetPayload) +
        `\n\n## Method and settings\nDistance step: ${params.distanceStep} m; smoothing: ${params.smoothingWindow} source samples.\n${sectorAlignment.mode === "sector-anchored" ? "Distance is aligned piecewise at official sector times. Agreement at these anchors is enforced, not independent validation." : "Only start and finish are anchored to official lap timing."}\nMini-sectors use source telemetry, independently of the display grid and smoothing. Interior delta remains estimated.\n${qualityWarnings.join("\n")}`,
    },
  };

  await prisma.comparisonCache.upsert({
    where: {
      referenceLapId_targetLapId_distanceStep_smoothingWindow: {
        referenceLapId: params.referenceLapId,
        targetLapId: params.targetLapId,
        distanceStep: params.distanceStep,
        smoothingWindow: params.smoothingWindow,
      },
    },
    update: {
      payload,
    },
    create: {
      sessionId: params.sessionId,
      referenceLapId: params.referenceLapId,
      targetLapId: params.targetLapId,
      distanceStep: params.distanceStep,
      smoothingWindow: params.smoothingWindow,
      payload,
    },
  });

  return payload;
}

function buildTelemetryPoints(input: {
  lap: LapContext;
  carData: Awaited<ReturnType<typeof getOpenF1CarData>>;
  locationData: Awaited<ReturnType<typeof getOpenF1Location>>;
}) {
  const lapStartMs = input.lap.dateStart.getTime();
  const lapEndMs = lapStartMs + (input.lap.lapDuration ?? 0) * 1000;
  const source = [
    ...new Map(
      [...input.carData]
        .sort(compareByDate)
        .map((point) => [Date.parse(point.date), point]),
    ).values(),
  ];
  const inside = source.filter(
    (point) =>
      Date.parse(point.date) >= lapStartMs &&
      Date.parse(point.date) <= lapEndMs,
  );
  if (inside.length < 3)
    throw new HttpError(422, "Insufficient telemetry coverage for this lap.");
  const startGapMs = Math.max(0, Date.parse(source[0].date) - lapStartMs);
  const endGapMs = Math.max(
    0,
    lapEndMs - Date.parse(source[source.length - 1].date),
  );
  const maxGapMs = Math.max(
    0,
    ...source
      .slice(1)
      .map(
        (point, index) =>
          Date.parse(point.date) - Date.parse(source[index].date),
      ),
  );
  if (startGapMs > 750 || endGapMs > 750 || maxGapMs > 2000)
    throw new HttpError(
      422,
      "Telemetry has missing lap boundaries or gaps over 2 seconds. Choose another lap.",
    );
  const boundary = (timestamp: number) => {
    const rightIndex = source.findIndex(
      (point) => Date.parse(point.date) >= timestamp,
    );
    const right = source[rightIndex < 0 ? source.length - 1 : rightIndex];
    const left =
      source[Math.max(0, rightIndex < 0 ? source.length - 1 : rightIndex - 1)];
    const span = Date.parse(right.date) - Date.parse(left.date);
    const ratio =
      span > 0
        ? Math.max(0, Math.min(1, (timestamp - Date.parse(left.date)) / span))
        : 0;
    const discrete = timestamp >= Date.parse(right.date) ? right : left;
    return {
      ...discrete,
      date: new Date(timestamp).toISOString(),
      speed: interpolate(left.speed, right.speed, ratio),
      throttle: interpolate(left.throttle, right.throttle, ratio),
    };
  };
  const sortedCarData = [
    boundary(lapStartMs),
    ...inside.filter(
      (point) =>
        Date.parse(point.date) > lapStartMs &&
        Date.parse(point.date) < lapEndMs,
    ),
    boundary(lapEndMs),
  ];
  const quality = {
    sourceSamples: inside.length,
    maxGapMs,
    startGapMs,
    endGapMs,
    boundaryEstimated: true,
    timingAnchored: true,
  };
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

    const locationState = interpolateLocationState(
      locationTimeline,
      timestampMs,
    );
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
      z: locationState?.z ?? null,
    });
  }

  const lapLength = Math.max(points[points.length - 1]?.distanceM ?? 1, 1);

  if (lapLength < 100)
    throw new HttpError(
      422,
      "Telemetry does not cover a meaningful lap distance.",
    );
  return {
    points: points.map((point) => ({
      ...point,
      relativeDistance: point.distanceM / lapLength,
    })),
    quality,
  };
}

function buildLocationTimeline(
  locationData: Awaited<ReturnType<typeof getOpenF1Location>>,
) {
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
      z: point.z,
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
  timestampMs: number,
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

  let upper = timeline.length - 1;
  while (leftIndex + 1 < upper) {
    const middle = Math.floor((leftIndex + upper) / 2);
    if (timeline[middle].timestampMs <= timestampMs) leftIndex = middle;
    else upper = middle;
  }

  const left = timeline[leftIndex];
  const right = timeline[leftIndex + 1];
  const ratio =
    left.timestampMs === right.timestampMs
      ? 0
      : (timestampMs - left.timestampMs) /
        (right.timestampMs - left.timestampMs);

  return {
    timestampMs,
    distanceM: round(interpolate(left.distanceM, right.distanceM, ratio)),
    x: round(interpolate(left.x, right.x, ratio)),
    y: round(interpolate(left.y, right.y, ratio)),
    z: round(interpolate(left.z, right.z, ratio)),
  };
}

function normalizeTelemetry(
  points: TelemetryPoint[],
  options?: {
    scaleToDistanceM?: number;
  },
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
      y: point.y,
    };

    if (
      normalized.length > 0 &&
      Math.abs(normalized[normalized.length - 1].distanceM - distanceM) < 0.001
    ) {
      normalized[normalized.length - 1] = current;
      continue;
    }

    normalized.push(current);
  }

  const rawLapLengthM = normalized[normalized.length - 1]?.distanceM ?? 0;
  const requestedDistance =
    options?.scaleToDistanceM && options.scaleToDistanceM > 0
      ? options.scaleToDistanceM
      : rawLapLengthM;
  const rawScaleFactor =
    rawLapLengthM > 0 ? requestedDistance / rawLapLengthM : 1;
  const scaleFactor =
    Number.isFinite(rawScaleFactor) && rawScaleFactor > 0 ? rawScaleFactor : 1;
  const scaledPoints = deduplicateComparablePoints(
    normalized.map((point) => ({
      ...point,
      distanceM: roundDistance(point.distanceM * scaleFactor),
    })),
  );

  return {
    points: scaledPoints,
    rawLapLengthM: round(rawLapLengthM),
    normalizedLapLengthM: roundDistance(
      scaledPoints[scaledPoints.length - 1]?.distanceM ?? 0,
    ),
    scaleFactor,
    firstSampleOffsetMs: round(normalized[0]?.timeOffsetMs ?? 0),
  };
}

type TimedTelemetryLap = Pick<Lap,
  "lapDuration" | "durationSector1" | "durationSector2" | "durationSector3"
> & { telemetryPoints: TelemetryPoint[] };

// A time anchor splits a source interval without changing its measured channels.
function pointAtTime(points: ComparablePoint[], timeMs: number): ComparablePoint {
  let left = 0, right = points.length - 1;
  while (left + 1 < right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid].timeOffsetMs <= timeMs) left = mid;
    else right = mid;
  }
  const a = points[left], b = points[right];
  const ratio = Math.max(0, Math.min(1,
    (timeMs - a.timeOffsetMs) / (b.timeOffsetMs - a.timeOffsetMs)));
  return {
    ...a,
    timeOffsetMs: timeMs,
    distanceM: interpolate(a.distanceM, b.distanceM, ratio),
    speedKph: interpolate(a.speedKph, b.speedKph, ratio),
    throttlePct: interpolate(a.throttlePct, b.throttlePct, ratio),
    brakePct: ratio >= 1 ? b.brakePct : a.brakePct,
    gear: ratio >= 1 ? b.gear : a.gear,
    rpm: interpolateNullable(a.rpm, b.rpm, ratio),
    x: interpolateNullable(a.x, b.x, ratio),
    y: interpolateNullable(a.y, b.y, ratio),
    timingAnchor: true,
  };
}

function officialTimingAnchors(lap: TimedTelemetryLap, points: ComparablePoint[]) {
  const sectors = [lap.durationSector1, lap.durationSector2, lap.durationSector3];
  if (!lap.lapDuration || sectors.some((t) => t === null || !Number.isFinite(t) || t <= 0))
    return null;
  const [s1, s2, s3] = sectors as number[];
  // Three millisecond rounding tolerance, not an estimate of telemetry accuracy.
  if (Math.abs((s1 + s2 + s3 - lap.lapDuration) * 1000) > 3.001)
    return null;
  const times = [0, round(s1 * 1000), round((s1 + s2) * 1000), round(lap.lapDuration * 1000)];
  if (points.length < 2 || Math.abs(points[0].timeOffsetMs) > 0.001 ||
      Math.abs(points[points.length - 1].timeOffsetMs - times[3]) > 0.001 ||
      points.some((p, i) => !Number.isFinite(p.distanceM) || !Number.isFinite(p.timeOffsetMs) ||
        (i > 0 && (p.distanceM <= points[i - 1].distanceM || p.timeOffsetMs <= points[i - 1].timeOffsetMs))))
    return null;
  const anchors = times.map((t) => pointAtTime(points, t));
  if (anchors.some((p, i) => i > 0 &&
      (p.timeOffsetMs <= anchors[i - 1].timeOffsetMs || p.distanceM - anchors[i - 1].distanceM < 1)))
    return null;
  return anchors;
}

function normalizeComparisonTelemetry(leftLap: TimedTelemetryLap, rightLap: TimedTelemetryLap) {
  for (const lap of [leftLap, rightLap]) {
    if (lap.telemetryPoints.some((p, i) =>
      !Number.isFinite(p.timeOffsetMs) || !Number.isFinite(p.distanceM) ||
      (i > 0 && p.timeOffsetMs <= lap.telemetryPoints[i - 1].timeOffsetMs))) {
      throw new HttpError(422, "Telemetry has invalid or non-increasing timestamps. Reimport the lap before comparing.");
    }
  }
  const leftRaw = normalizeTelemetry(leftLap.telemetryPoints);
  const rightRaw = normalizeTelemetry(rightLap.telemetryPoints);
  // Symmetric axis: swapping the two laps changes only the sign of the delta.
  const commonLength = roundDistance((leftRaw.rawLapLengthM + rightRaw.rawLapLengthM) / 2);
  const reference = normalizeTelemetry(leftLap.telemetryPoints, { scaleToDistanceM: commonLength });
  const target = normalizeTelemetry(rightLap.telemetryPoints, { scaleToDistanceM: commonLength });
  const fallback = (reason: string) => ({ reference, target, sectorAlignment: {
    mode: "lap-scaled" as "lap-scaled" | "sector-anchored",
    reason: reason as string | null,
    anchors: [] as Array<{ sector: number; distanceM: number; referenceTimeMs: number;
      targetTimeMs: number; officialDeltaMs: number; unanchoredDeltaMs: number }>,
    referenceSegmentScaleFactors: [] as number[],
    targetSegmentScaleFactors: [] as number[],
  } });
  const leftAnchors = officialTimingAnchors(leftLap, reference.points);
  const rightAnchors = officialTimingAnchors(rightLap, target.points);
  if (!leftAnchors || !rightAnchors)
    return fallback("Sector alignment unavailable: both laps need complete, consistent sector timing and monotonic telemetry. Only lap boundaries are anchored.");
  const distances = leftAnchors.map((p, i) =>
    i === 3 ? commonLength : roundDistance((p.distanceM + rightAnchors[i].distanceM) / 2));
  const factors = (anchors: ComparablePoint[]) => anchors.slice(1).map((p, i) =>
    (distances[i + 1] - distances[i]) / (p.distanceM - anchors[i].distanceM));
  const leftFactors = factors(leftAnchors), rightFactors = factors(rightAnchors);
  // Reject implausibly large warps instead of hiding inconsistent input by force.
  // This 10% guard is a plausibility rule, not a confidence interval.
  if ([...leftFactors, ...rightFactors].some((f) => !Number.isFinite(f) || Math.abs(f - 1) > 0.1))
    return fallback("Sector alignment rejected: a sector needs more than 10% additional distance scaling. Only lap boundaries are anchored; local comparison is uncertain.");
  const warp = (normalized: NormalizedTelemetry, anchors: ComparablePoint[], scales: number[]) => {
    let segment = 0;
    const originals = normalized.points.map((p) => {
      while (segment < 2 && p.timeOffsetMs > anchors[segment + 1].timeOffsetMs) segment++;
      return { ...p, distanceM: distances[segment] +
        (p.distanceM - anchors[segment].distanceM) * scales[segment] };
    });
    // Explicit breakpoints prevent interpolation across two different sector scales.
    const points = originals.filter((p) => !anchors.some((a) => a.timeOffsetMs === p.timeOffsetMs));
    anchors.forEach((a, i) => {
      const original = normalized.points.find((p) => p.timeOffsetMs === a.timeOffsetMs);
      points.push({ ...(original ?? a), distanceM: distances[i] });
    });
    points.sort((a, b) => a.timeOffsetMs - b.timeOffsetMs);
    return { ...normalized, points };
  };
  return {
    reference: warp(reference, leftAnchors, leftFactors),
    target: warp(target, rightAnchors, rightFactors),
    sectorAlignment: {
      mode: "sector-anchored" as const,
      reason: null,
      anchors: leftAnchors.slice(1, 3).map((p, i) => ({
        sector: i + 1,
        distanceM: distances[i + 1],
        referenceTimeMs: p.timeOffsetMs,
        targetTimeMs: rightAnchors[i + 1].timeOffsetMs,
        officialDeltaMs: round(p.timeOffsetMs - rightAnchors[i + 1].timeOffsetMs),
        unanchoredDeltaMs: round(timeAtDistance(reference.points, distances[i + 1]) -
          timeAtDistance(target.points, distances[i + 1])),
      })),
      referenceSegmentScaleFactors: leftFactors,
      targetSegmentScaleFactors: rightFactors,
    },
  };
}

function alignTelemetry(params: {
  points: ComparablePoint[];
  distanceStep: number;
  smoothingWindow: number;
  maxDistance: number;
  anchorDistances?: number[];
}) {
  if (params.points.length < 2 || params.maxDistance <= 0)
    throw new HttpError(422, "Not enough distance samples to compare.");
  const smoothed = smoothComparablePoints(
    params.points,
    params.smoothingWindow,
  );
  const aligned: AlignedPoint[] = [];
  let leftIndex = 0;

  const grid = Array.from(
    { length: Math.ceil(params.maxDistance / params.distanceStep) },
    (_, index) => index * params.distanceStep,
  );
  grid.push(params.maxDistance, ...(params.anchorDistances ?? []));
  // Round before de-duplicating so a near-grid anchor cannot create duplicate X values.
  const distances = [...new Set(grid.map((d) => roundDistance(d)))].sort((a, b) => a - b);
  for (const distance of distances) {
    while (
      leftIndex < smoothed.length - 2 &&
      smoothed[leftIndex + 1].distanceM < distance
    ) {
      leftIndex += 1;
    }

    const left = smoothed[leftIndex];
    const right = smoothed[Math.min(smoothed.length - 1, leftIndex + 1)];

    if (left.distanceM === right.distanceM) {
      aligned.push({
        ...left,
        distanceM: roundDistance(distance),
      });
      continue;
    }

    const ratio = Math.max(
      0,
      Math.min(
        1,
        (distance - left.distanceM) / (right.distanceM - left.distanceM),
      ),
    );

    aligned.push({
      distanceM: roundDistance(distance),
      timeOffsetMs: round(
        interpolate(left.timeOffsetMs, right.timeOffsetMs, ratio),
      ),
      speedKph: round(interpolate(left.speedKph, right.speedKph, ratio)),
      throttlePct: round(
        interpolate(left.throttlePct, right.throttlePct, ratio),
      ),
      brakePct: ratio >= 1 ? right.brakePct : left.brakePct,
      gear: ratio >= 1 ? right.gear : left.gear,
      rpm: roundNullable(interpolateNullable(left.rpm, right.rpm, ratio)),
      x: roundNullable(interpolateNullable(left.x, right.x, ratio)),
      y: roundNullable(interpolateNullable(left.y, right.y, ratio)),
    });
  }

  return aligned;
}

function smoothComparablePoints(points: ComparablePoint[], windowSize: number) {
  if (points.some((p) => p.timingAnchor)) {
    // Inserted sector anchors are not extra sensor samples in the smoothing window.
    const source = smoothComparablePoints(points.filter((p) => !p.timingAnchor), windowSize);
    let index = 0;
    return points.map((p): ComparablePoint => {
      if (!p.timingAnchor) return source[index++];
      const channels = pointAtTime(source, p.timeOffsetMs);
      return { ...p, speedKph: channels.speedKph, throttlePct: channels.throttlePct };
    });
  }
  const radius = Math.max(0, Math.floor(windowSize / 2));

  return points.map((point, index) => {
    let speedSum = 0;
    let throttleSum = 0;
    let count = 0;

    for (
      let cursor = Math.max(0, index - radius);
      cursor <= Math.min(points.length - 1, index + radius);
      cursor += 1
    ) {
      speedSum += points[cursor].speedKph;
      throttleSum += points[cursor].throttlePct;
      count += 1;
    }

    return {
      ...point,
      speedKph: round(speedSum / count),
      throttlePct: round(throttleSum / count),
      brakePct: point.brakePct,
    };
  });
}

function buildLapPayload(
  lap: Lap & {
    driver: Driver;
    telemetryPoints: TelemetryPoint[];
  },
  alignedPoints: AlignedPoint[],
  normalizedTelemetry: NormalizedTelemetry,
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
      color: lap.driver.teamColour ? `#${lap.driver.teamColour}` : "#1d4ed8",
    },
    summary: {
      topSpeedKph: round(
        Math.max(...lap.telemetryPoints.map((point) => point.speedKph)),
      ),
      averageSpeedKph: round(
        (normalizedTelemetry.rawLapLengthM / (lap.lapDuration ?? 1)) * 3.6,
      ),
      averageThrottlePct: round(
        timeWeightedAverage(lap.telemetryPoints, "throttlePct"),
      ),
      peakBrakePct: round(
        Math.max(...alignedPoints.map((point) => point.brakePct)),
      ),
      lapTimeMs:
        lap.lapDuration !== null
          ? Math.round(lap.lapDuration * 1000)
          : round(alignedPoints[alignedPoints.length - 1]?.timeOffsetMs ?? 0),
    },
    sectors: {
      sector1Ms: toMilliseconds(lap.durationSector1),
      sector2Ms: toMilliseconds(lap.durationSector2),
      sector3Ms: toMilliseconds(lap.durationSector3),
    },
    tyre: {
      compound: lap.tyreCompound,
      age: lap.tyreAge,
      stint: lap.stint,
    },
    points: alignedPoints,
    distance: {
      rawLapLengthM: normalizedTelemetry.rawLapLengthM,
      normalizedLapLengthM: normalizedTelemetry.normalizedLapLengthM,
      scaleFactor: normalizedTelemetry.scaleFactor,
      firstSampleOffsetMs: normalizedTelemetry.firstSampleOffsetMs,
    },
    events: detectBrakingZones(normalizedTelemetry.points),
  };
}

function deduplicateComparablePoints(points: ComparablePoint[]) {
  const deduplicated: ComparablePoint[] = [];

  for (const point of points) {
    if (
      deduplicated.length > 0 &&
      Math.abs(
        deduplicated[deduplicated.length - 1].distanceM - point.distanceM,
      ) < 0.001
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
      targetMs: toMilliseconds(params.targetLap.durationSector1),
    },
    {
      label: "Sector 2",
      referenceMs: toMilliseconds(params.referenceLap.durationSector2),
      targetMs: toMilliseconds(params.targetLap.durationSector2),
    },
    {
      label: "Sector 3",
      referenceMs: toMilliseconds(params.referenceLap.durationSector3),
      targetMs: toMilliseconds(params.targetLap.durationSector3),
    },
  ].map((sector) => {
    const deltaMs =
      sector.referenceMs === null || sector.targetMs === null
        ? null
        : round(sector.referenceMs - sector.targetMs);

    return {
      ...sector,
      deltaMs,
      winner:
        deltaMs === null
          ? "unavailable"
          : deltaMs > 0.5
            ? params.targetDriver
            : deltaMs < -0.5
              ? params.referenceDriver
              : "Even",
    };
  });

  const strongestSector =
    [...sectors]
      .filter((sector) => sector.deltaMs !== null)
      .sort(
        (left, right) =>
          Math.abs(right.deltaMs ?? 0) - Math.abs(left.deltaMs ?? 0),
      )[0] ?? null;

  return {
    sectors,
    summary: {
      strongestSectorLabel: strongestSector?.label ?? null,
      strongestSectorWinner: strongestSector?.winner ?? null,
      strongestSectorDeltaMs: strongestSector?.deltaMs ?? null,
      targetBetterCount: sectors.filter(
        (sector) => sector.winner === params.targetDriver,
      ).length,
      referenceBetterCount: sectors.filter(
        (sector) => sector.winner === params.referenceDriver,
      ).length,
    },
  };
}

function buildCornerAnalysis(params: {
  referenceLap: LapPayload;
  targetLap: LapPayload;
  deltaPoints: DeltaPoint[];
}) {
  const mergedCorners = mergeCornerEvents(
    params.referenceLap.events,
    params.targetLap.events,
  );
  const corners = mergedCorners.map((corner, index) => {
    const referenceMetrics = summarizeCornerWindow(
      params.referenceLap.points,
      corner.entryDistanceM,
      corner.peakDistanceM,
      corner.exitDistanceM,
    );
    const targetMetrics = summarizeCornerWindow(
      params.targetLap.points,
      corner.entryDistanceM,
      corner.peakDistanceM,
      corner.exitDistanceM,
    );
    const entryDeltaMs = sampleDeltaAtDistance(
      params.deltaPoints,
      corner.entryDistanceM,
    );
    const apexDeltaMs = sampleDeltaAtDistance(
      params.deltaPoints,
      corner.peakDistanceM,
    );
    const exitDeltaMs = sampleDeltaAtDistance(
      params.deltaPoints,
      corner.exitDistanceM,
    );
    const phaseDeltaMs = round(exitDeltaMs - entryDeltaMs);
    const fasterDriver =
      phaseDeltaMs > 15
        ? lapLabel(params.targetLap)
        : phaseDeltaMs < -15
          ? lapLabel(params.referenceLap)
          : "Even";

    return {
      key: `corner-${index + 1}`,
      label: `Braking zone ${index + 1}`,
      distanceM: corner.peakDistanceM,
      entryDistanceM: corner.entryDistanceM,
      exitDistanceM: corner.exitDistanceM,
      reference: referenceMetrics,
      target: targetMetrics,
      entryDeltaMs,
      apexDeltaMs,
      exitDeltaMs,
      phaseDeltaMs,
      fasterDriver,
    };
  });

  const biggestTargetGain =
    [...corners].sort(
      (left, right) => right.phaseDeltaMs - left.phaseDeltaMs,
    )[0] ?? null;
  const biggestReferenceGain =
    [...corners].sort(
      (left, right) => left.phaseDeltaMs - right.phaseDeltaMs,
    )[0] ?? null;

  return {
    corners,
    summary: {
      targetBetterCorners: corners.filter(
        (corner) => corner.fasterDriver === lapLabel(params.targetLap),
      ).length,
      referenceBetterCorners: corners.filter(
        (corner) => corner.fasterDriver === lapLabel(params.referenceLap),
      ).length,
      biggestTargetGainLabel:
        biggestTargetGain && biggestTargetGain.phaseDeltaMs > 0
          ? biggestTargetGain.label
          : null,
      biggestTargetGainMs:
        biggestTargetGain && biggestTargetGain.phaseDeltaMs > 0
          ? biggestTargetGain.phaseDeltaMs
          : null,
      biggestReferenceGainLabel:
        biggestReferenceGain && biggestReferenceGain.phaseDeltaMs < 0
          ? biggestReferenceGain.label
          : null,
      biggestReferenceGainMs:
        biggestReferenceGain && biggestReferenceGain.phaseDeltaMs < 0
          ? biggestReferenceGain.phaseDeltaMs
          : null,
    },
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
  const finalDeltaMs =
    params.deltaPoints[params.deltaPoints.length - 1]?.deltaMs ?? 0;
  const winner =
    Math.abs(finalDeltaMs) < 0.5
      ? "Neither lap"
      : finalDeltaMs > 0
        ? lapLabel(params.targetLap)
        : lapLabel(params.referenceLap);
  const winnerMarginMs = Math.abs(finalDeltaMs);
  const strongestSectors = [...params.sectorAnalysis.sectors]
    .filter((sector) => sector.deltaMs !== null)
    .sort(
      (left, right) =>
        Math.abs(right.deltaMs ?? 0) - Math.abs(left.deltaMs ?? 0),
    )
    .slice(0, 3)
    .map((sector) => ({
      label: sector.label,
      winner: sector.winner,
      deltaMs: sector.deltaMs ?? 0,
      note:
        sector.winner === "Even"
          ? `${sector.label} is effectively matched between both laps.`
          : `${sector.winner} is quicker in ${sector.label} by ${formatDeltaMs(Math.abs(sector.deltaMs ?? 0))}.`,
    }));
  const biggestLosses = [...params.cornerAnalysis.corners]
    .sort(
      (left, right) =>
        Math.abs(right.phaseDeltaMs) - Math.abs(left.phaseDeltaMs),
    )
    .slice(0, 3)
    .map((corner) => ({
      label: corner.label,
      owner:
        corner.phaseDeltaMs > 0
          ? lapLabel(params.referenceLap)
          : lapLabel(params.targetLap),
      deltaMs: round(Math.abs(corner.phaseDeltaMs)),
      note:
        corner.phaseDeltaMs > 0
          ? `${lapLabel(params.targetLap)} gains ${formatDeltaMs(Math.abs(corner.phaseDeltaMs))} in ${corner.label}.`
          : `${lapLabel(params.referenceLap)} gains ${formatDeltaMs(Math.abs(corner.phaseDeltaMs))} in ${corner.label}.`,
    }));
  const tyreNotes = buildTyreNotes(params.referenceLap, params.targetLap);
  const brakeNotes = buildBrakeNotes(
    params.cornerAnalysis,
    lapLabel(params.referenceLap),
    lapLabel(params.targetLap),
  );
  const summary = [
    winnerMarginMs < 0.5
      ? "Both selected laps have the same official lap time."
      : `${winner} finishes this comparison ${formatDeltaMs(winnerMarginMs)} ahead over the full lap.`,
    `${lapLabel(params.targetLap)} is better in ${params.cornerAnalysis.summary.targetBetterCorners} braking zones, ${lapLabel(params.referenceLap)} in ${params.cornerAnalysis.summary.referenceBetterCorners}.`,
    params.sectorAnalysis.summary.strongestSectorLabel &&
    params.sectorAnalysis.summary.strongestSectorWinner
      ? `${params.sectorAnalysis.summary.strongestSectorLabel} is the biggest swing for ${params.sectorAnalysis.summary.strongestSectorWinner}.`
      : "Sector deltas are too close to call cleanly.",
    tyreNotes[0] ?? "Tyre metadata is limited for one or both laps.",
  ];
  const headline =
    winnerMarginMs < 0.5
      ? "The selected laps are tied on official lap time."
      : `${winner} holds the lap advantage in ${params.session.year} ${params.session.countryName} ${params.session.sessionName}.`;
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
    brakeNotes,
  });

  return {
    headline,
    summary,
    strongestSectors,
    biggestLosses,
    tyreNotes,
    brakeNotes,
    exportMarkdown,
  };
}

function mergeCornerEvents(
  referenceEvents: BrakingZone[],
  targetEvents: BrakingZone[],
) {
  const allEvents = [
    ...referenceEvents.map((event) => ({ ...event, source: "reference" })),
    ...targetEvents.map((event) => ({ ...event, source: "target" })),
  ].sort((left, right) => left.peakDistanceM - right.peakDistanceM);
  const merged: Array<{
    peakDistanceM: number;
    entryDistanceM: number;
    exitDistanceM: number;
    members: Array<(typeof allEvents)[number]>;
  }> = [];

  for (const event of allEvents) {
    const current = merged[merged.length - 1];

    if (
      current &&
      !current.members.some((member) => member.source === event.source) &&
      Math.abs(current.peakDistanceM - event.peakDistanceM) <= 140
    ) {
      current.members.push(event);
      current.peakDistanceM = round(
        average(current.members.map((member) => member.peakDistanceM)),
      );
      current.entryDistanceM = round(
        Math.min(current.entryDistanceM, event.startDistanceM),
      );
      current.exitDistanceM = round(
        Math.max(current.exitDistanceM, event.throttlePickupM),
      );
      continue;
    }

    merged.push({
      peakDistanceM: event.peakDistanceM,
      entryDistanceM: event.startDistanceM,
      exitDistanceM: event.throttlePickupM,
      members: [event],
    });
  }

  return merged;
}

function summarizeCornerWindow(
  points: AlignedPoint[],
  entryDistanceM: number,
  peakDistanceM: number,
  exitDistanceM: number,
) {
  const segment = points.filter(
    (point) =>
      point.distanceM >= entryDistanceM && point.distanceM <= exitDistanceM,
  );
  const fallbackSegment = segment.length > 0 ? segment : points;
  const entryPoint = findClosestPointByDistance(points, entryDistanceM);
  const apexPoint =
    [...fallbackSegment].sort(
      (left, right) => left.speedKph - right.speedKph,
    )[0] ?? entryPoint;
  const exitPoint = findClosestPointByDistance(points, exitDistanceM);

  return {
    entrySpeedKph: round(entryPoint.speedKph),
    apexSpeedKph: round(apexPoint.speedKph),
    exitSpeedKph: round(exitPoint.speedKph),
    peakBrakePct: round(
      Math.max(...fallbackSegment.map((point) => point.brakePct)),
    ),
    throttleAtExitPct: round(exitPoint.throttlePct),
    apexDistanceM: round(apexPoint.distanceM),
    peakDistanceM: round(peakDistanceM),
  };
}

function sampleDeltaAtDistance(deltaPoints: DeltaPoint[], distanceM: number) {
  return round(findClosestDeltaPoint(deltaPoints, distanceM).deltaMs);
}

function buildTyreNotes(referenceLap: LapPayload, targetLap: LapPayload) {
  const notes = [
    `${lapLabel(referenceLap)}: ${formatTyreLabel(referenceLap.tyre)}.`,
    `${lapLabel(targetLap)}: ${formatTyreLabel(targetLap.tyre)}.`,
  ];
  const compoundGap =
    referenceLap.tyre.compound &&
    targetLap.tyre.compound &&
    referenceLap.tyre.compound !== targetLap.tyre.compound
      ? `Compound split: ${lapLabel(referenceLap)} on ${referenceLap.tyre.compound}, ${lapLabel(targetLap)} on ${targetLap.tyre.compound}.`
      : null;
  const ageGap =
    referenceLap.tyre.age !== null && targetLap.tyre.age !== null
      ? `${Math.abs(referenceLap.tyre.age - targetLap.tyre.age)} lap tyre-age gap between the selected laps.`
      : null;

  return [...notes, compoundGap, ageGap].filter((note): note is string =>
    Boolean(note),
  );
}

function buildBrakeNotes(
  cornerAnalysis: ReturnType<typeof buildCornerAnalysis>,
  referenceDriver: string,
  targetDriver: string,
) {
  if (cornerAnalysis.corners.length === 0) {
    return ["Not enough braking windows to extract notes."];
  }

  const biggestExitGap = [...cornerAnalysis.corners].sort((left, right) => {
    const leftGap = Math.abs(
      left.reference.exitSpeedKph - left.target.exitSpeedKph,
    );
    const rightGap = Math.abs(
      right.reference.exitSpeedKph - right.target.exitSpeedKph,
    );
    return rightGap - leftGap;
  })[0];

  const exitLeader =
    biggestExitGap.reference.exitSpeedKph > biggestExitGap.target.exitSpeedKph
      ? referenceDriver
      : targetDriver;

  return [
    "Brake telemetry indicates pedal on/off only; braking force cannot be inferred.",
    Math.abs(
      biggestExitGap.reference.exitSpeedKph -
        biggestExitGap.target.exitSpeedKph,
    ) < 0.5
      ? "Exit speeds are effectively matched."
      : `${exitLeader} carries the higher estimated exit speed in ${biggestExitGap.label}.`,
    cornerAnalysis.summary.biggestTargetGainLabel
      ? `${targetDriver}'s best corner phase is ${cornerAnalysis.summary.biggestTargetGainLabel}.`
      : `${targetDriver} does not show a decisive corner-phase gain.`,
    cornerAnalysis.summary.biggestReferenceGainLabel
      ? `${referenceDriver}'s best corner phase is ${cornerAnalysis.summary.biggestReferenceGainLabel}.`
      : `${referenceDriver} does not show a decisive corner-phase gain.`,
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
    `Final delta (left/reference minus right/comparison): ${formatSignedMilliseconds(input.finalDeltaMs)}`,
    "Positive = left lap loses time; negative = left lap gains time.",
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
    ...input.brakeNotes.map((line) => `- ${line}`),
  ].join("\n");
}

function isComparisonCacheCompatible(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("settings" in payload)
  ) {
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
  let start: AlignedPoint | null = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!start && point.brakePct >= 50) start = point;
    if (start && (point.brakePct < 50 || index === points.length - 1)) {
      let pickup = point.distanceM;
      for (let cursor = index; cursor < points.length; cursor++) {
        const candidate = points[cursor];
        if (cursor > index && candidate.brakePct >= 50) break;
        pickup = candidate.distanceM;
        if (candidate.throttlePct >= 85) break;
      }
      events.push({
        label: "Zone " + (events.length + 1),
        startDistanceM: start.distanceM,
        peakDistanceM: start.distanceM,
        peakBrakePct: 100,
        throttlePickupM: pickup,
      });
      start = null;
    }
  }
  return events;
}

function summarizeDelta(
  deltaPoints: DeltaPoint[],
  referenceLapId: number,
  targetLapId: number,
) {
  const finalDeltaMs = deltaPoints[deltaPoints.length - 1]?.deltaMs ?? 0;

  return {
    referenceLapId,
    targetLapId,
    finalDeltaMs: round(finalDeltaMs),
    bestTargetGainMs: round(
      Math.max(0, ...deltaPoints.map((point) => point.deltaMs)),
    ),
    biggestTargetLossMs: round(
      Math.min(0, ...deltaPoints.map((point) => point.deltaMs)),
    ),
    winnerLapId:
      Math.abs(finalDeltaMs) < 0.5
        ? null
        : finalDeltaMs > 0
          ? targetLapId
          : referenceLapId,
  };
}

function timeWeightedAverage(points: TelemetryPoint[], key: "throttlePct") {
  let area = 0;
  for (let index = 1; index < points.length; index++)
    area +=
      ((points[index - 1][key] + points[index][key]) / 2) *
      (points[index].timeOffsetMs - points[index - 1].timeOffsetMs);
  return (
    area /
    Math.max(
      1,
      (points[points.length - 1]?.timeOffsetMs ?? 0) -
        (points[0]?.timeOffsetMs ?? 0),
    )
  );
}
function average(values: number[]) {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  );
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
  },
) {
  return Math.sqrt(
    (right.x - left.x) ** 2 + (right.y - left.y) ** 2 + (right.z - left.z) ** 2,
  );
}

function interpolate(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function interpolateNullable(
  start: number | null,
  end: number | null,
  ratio: number,
) {
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

// Keep distance transforms precise; rounding to decimetres here adds timing error.
function roundDistance(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value);
}

function lapLabel(lap: LapPayload) {
  return `${lap.driver.acronym} L${lap.lapNumber}`;
}

function timeAtDistance(points: AlignedPoint[], distanceM: number) {
  let left = 0,
    right = points.length - 1;
  if (distanceM <= points[0].distanceM) return points[0].timeOffsetMs;
  if (distanceM >= points[right].distanceM) return points[right].timeOffsetMs;
  while (left + 1 < right) {
    const mid = Math.floor((left + right) / 2);
    if (points[mid].distanceM <= distanceM) left = mid;
    else right = mid;
  }
  const ratio =
    (distanceM - points[left].distanceM) /
    (points[right].distanceM - points[left].distanceM);
  return round(
    interpolate(points[left].timeOffsetMs, points[right].timeOffsetMs, ratio),
  );
}

function buildMiniSectors(
  reference: AlignedPoint[],
  target: AlignedPoint[],
  distanceM: number,
) {
  const count = 20;
  const boundaries = Array.from({ length: count + 1 }, (_, i) => {
    const distance = i === count ? distanceM : round((distanceM * i) / count);
    return {
      distance,
      referenceMs: timeAtDistance(reference, distance),
      targetMs: timeAtDistance(target, distance),
    };
  });
  return boundaries.slice(1).map((end, index) => {
    const start = boundaries[index];
    const referenceMs = round(end.referenceMs - start.referenceMs);
    const targetMs = round(end.targetMs - start.targetMs);
    const deltaMs = round(referenceMs - targetMs);
    return {
      number: index + 1,
      startDistanceM: start.distance,
      endDistanceM: end.distance,
      referenceMs,
      targetMs,
      deltaMs,
      winner: deltaMs > 0.5 ? "target" : deltaMs < -0.5 ? "reference" : "even",
    };
  });
}

function buildMiniSectorMarkdown(
  sectors: ReturnType<typeof buildMiniSectors>,
  reference: LapPayload,
  target: LapPayload,
) {
  return [
    "",
    "",
    "## Mini-sectors (estimated, equal-distance sections)",
    "Delta = " +
      lapLabel(reference) +
      " minus " +
      lapLabel(target) +
      ". Positive means the left lap loses time.",
    "",
    "| Section | Distance (m) | Left (s) | Right (s) | Delta (s) |",
    "| --- | --- | --- | --- | --- |",
    ...sectors.map(
      (s) =>
        "| M" +
        s.number +
        " | " +
        s.startDistanceM +
        "–" +
        s.endDistanceM +
        " | " +
        (s.referenceMs / 1000).toFixed(3) +
        " | " +
        (s.targetMs / 1000).toFixed(3) +
        " | " +
        formatSignedMilliseconds(s.deltaMs) +
        " |",
    ),
  ].join("\n");
}
