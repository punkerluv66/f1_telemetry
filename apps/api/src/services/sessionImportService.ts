import { runSessionTask } from "../lib/sessionQueue.js";
import { HttpError } from "../lib/errors.js";
import type { Driver, Lap, Session } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import {
  getOpenF1Drivers,
  getOpenF1Laps,
  getOpenF1PitStops,
  getOpenF1SessionByKey,
  getOpenF1SessionResults,
  getOpenF1Stints,
} from "../lib/openf1.js";

const sessionImports = new Map<
  number,
  Promise<{
    sessionId: number;
    sessionKey: number;
    driversImported: number;
    lapsImported: number;
  }>
>();
export function importSessionMetadata(sessionKey: number) {
  const existing = sessionImports.get(sessionKey);
  if (existing) return existing;
  const task = runSessionTask(sessionKey, () =>
    importSessionMetadataImpl(sessionKey),
  ).finally(() => sessionImports.delete(sessionKey));
  sessionImports.set(sessionKey, task);
  return task;
}
async function importSessionMetadataImpl(sessionKey: number) {
  const remoteSession = await getOpenF1SessionByKey(sessionKey);

  if (!remoteSession) {
    throw new HttpError(404, `OpenF1 session ${sessionKey} was not found.`);
  }

  const [
    remoteDrivers,
    remoteLaps,
    remoteResults,
    remotePitStops,
    remoteStints,
  ] = await Promise.all([
    getOpenF1Drivers(sessionKey),
    getOpenF1Laps(sessionKey),
    getOpenF1SessionResults(sessionKey),
    getOpenF1PitStops(sessionKey),
    getOpenF1Stints(sessionKey),
  ]);

  return prisma.$transaction(
    async (prisma) => {
      const session = await prisma.session.upsert({
        where: {
          sessionKey,
        },
        update: {
          meetingKey: remoteSession.meeting_key,
          sessionType: remoteSession.session_type,
          sessionName: remoteSession.session_name,
          circuitShortName: remoteSession.circuit_short_name,
          countryCode: remoteSession.country_code,
          countryName: remoteSession.country_name,
          location: remoteSession.location,
          gmtOffset: remoteSession.gmt_offset,
          year: remoteSession.year,
          dateStart: new Date(remoteSession.date_start),
          dateEnd: remoteSession.date_end
            ? new Date(remoteSession.date_end)
            : null,
        },
        create: {
          sessionKey,
          meetingKey: remoteSession.meeting_key,
          sessionType: remoteSession.session_type,
          sessionName: remoteSession.session_name,
          circuitShortName: remoteSession.circuit_short_name,
          countryCode: remoteSession.country_code,
          countryName: remoteSession.country_name,
          location: remoteSession.location,
          gmtOffset: remoteSession.gmt_offset,
          year: remoteSession.year,
          dateStart: new Date(remoteSession.date_start),
          dateEnd: remoteSession.date_end
            ? new Date(remoteSession.date_end)
            : null,
        },
      });

      for (const remoteDriver of remoteDrivers) {
        await prisma.driver.upsert({
          where: {
            sessionId_driverNumber: {
              sessionId: session.id,
              driverNumber: remoteDriver.driver_number,
            },
          },
          update: {
            sessionKey: remoteDriver.session_key,
            broadcastName: remoteDriver.broadcast_name,
            fullName: remoteDriver.full_name,
            firstName: remoteDriver.first_name,
            lastName: remoteDriver.last_name,
            acronym: remoteDriver.name_acronym,
            teamName: remoteDriver.team_name,
            teamColour: remoteDriver.team_colour,
            headshotUrl: remoteDriver.headshot_url,
            countryCode: remoteDriver.country_code,
          },
          create: {
            sessionId: session.id,
            sessionKey: remoteDriver.session_key,
            driverNumber: remoteDriver.driver_number,
            broadcastName: remoteDriver.broadcast_name,
            fullName: remoteDriver.full_name,
            firstName: remoteDriver.first_name,
            lastName: remoteDriver.last_name,
            acronym: remoteDriver.name_acronym,
            teamName: remoteDriver.team_name,
            teamColour: remoteDriver.team_colour,
            headshotUrl: remoteDriver.headshot_url,
            countryCode: remoteDriver.country_code,
          },
        });
      }

      const drivers = await prisma.driver.findMany({
        where: {
          sessionId: session.id,
        },
      });
      const driverByNumber = new Map<number, Driver>(
        drivers.map((driver) => [driver.driverNumber, driver]),
      );

      const previousLaps = await prisma.lap.findMany({
        where: { sessionId: session.id },
      });
      const previousByKey = new Map(
        previousLaps.map((lap) => [
          lap.driverNumber + ":" + lap.lapNumber,
          lap,
        ]),
      );
      await prisma.comparisonCache.deleteMany({
        where: { sessionId: session.id },
      });
      for (const remoteLap of remoteLaps) {
        const driver = driverByNumber.get(remoteLap.driver_number);

        if (!driver || !remoteLap.date_start) {
          continue;
        }

        const previous = previousByKey.get(
          remoteLap.driver_number + ":" + remoteLap.lap_number,
        );
        if (
          previous &&
          (previous.dateStart.getTime() !== Date.parse(remoteLap.date_start) ||
            previous.lapDuration !== remoteLap.lap_duration)
        ) {
          await prisma.telemetryPoint.deleteMany({
            where: { lapId: previous.id },
          });
          await prisma.lap.update({
            where: { id: previous.id },
            data: {
              telemetryImportedAt: null,
              telemetryStatus: "pending",
              telemetryMessage: null,
            },
          });
        }
        const lapStint = remoteStints.find(
          (s) =>
            s.driver_number === remoteLap.driver_number &&
            remoteLap.lap_number >= s.lap_start &&
            remoteLap.lap_number <= s.lap_end,
        );
        const tyreAge = lapStint
          ? (lapStint.tyre_age_at_start ?? 0) +
            (remoteLap.lap_number - lapStint.lap_start)
          : null;

        await prisma.lap.upsert({
          where: {
            sessionId_driverId_lapNumber: {
              sessionId: session.id,
              driverId: driver.id,
              lapNumber: remoteLap.lap_number,
            },
          },
          update: {
            sessionKey: remoteLap.session_key,
            driverNumber: remoteLap.driver_number,
            dateStart: new Date(remoteLap.date_start),
            lapDuration: remoteLap.lap_duration,
            durationSector1: remoteLap.duration_sector_1,
            durationSector2: remoteLap.duration_sector_2,
            durationSector3: remoteLap.duration_sector_3,
            speedTrap: remoteLap.st_speed,
            speedI1: remoteLap.i1_speed,
            speedI2: remoteLap.i2_speed,
            isPitOutLap: remoteLap.is_pit_out_lap,
            stint: lapStint?.stint_number ?? null,
            tyreCompound: lapStint?.compound ?? null,
            tyreAge,
          },
          create: {
            sessionId: session.id,
            driverId: driver.id,
            sessionKey: remoteLap.session_key,
            driverNumber: remoteLap.driver_number,
            lapNumber: remoteLap.lap_number,
            dateStart: new Date(remoteLap.date_start),
            lapDuration: remoteLap.lap_duration,
            durationSector1: remoteLap.duration_sector_1,
            durationSector2: remoteLap.duration_sector_2,
            durationSector3: remoteLap.duration_sector_3,
            speedTrap: remoteLap.st_speed,
            speedI1: remoteLap.i1_speed,
            speedI2: remoteLap.i2_speed,
            isPitOutLap: remoteLap.is_pit_out_lap,
            stint: lapStint?.stint_number ?? null,
            tyreCompound: lapStint?.compound ?? null,
            tyreAge,
          },
        });
      }

      const importedLaps = await prisma.lap.count({
        where: {
          sessionId: session.id,
        },
      });

      await refreshSessionDerivedData(prisma, {
        sessionId: session.id,
        sessionKey: session.sessionKey,
        driverByNumber,
        remoteResults,
        remotePitStops,
        remoteStints,
      });

      return {
        sessionId: session.id,
        sessionKey: session.sessionKey,
        driversImported: remoteDrivers.length,
        lapsImported: importedLaps,
      };
    },
    { timeout: 60_000 },
  );
}

export function listImportedSessions() {
  return prisma.session.findMany({
    orderBy: {
      dateStart: "desc",
    },
    include: {
      _count: {
        select: {
          drivers: true,
          laps: true,
        },
      },
    },
  });
}

export async function getSessionOverview(sessionId: number) {
  const session = await loadSessionOverview(sessionId);

  if (!session) {
    throw new HttpError(
      404,
      `Imported session ${sessionId} was not found in the database.`,
    );
  }

  const driverSummaries = session.drivers.map((driver) => {
    const pitLapNumbers = new Set(
      driver.pitStops
        .map((pitStop) => pitStop.lapNumber)
        .filter((lapNumber): lapNumber is number => lapNumber !== null),
    );
    const timedLaps = driver.laps.filter(
      (lap) =>
        lap.lapDuration !== null && lap.lapDuration > 0 && !lap.isPitOutLap,
    );
    const cleanLaps = timedLaps.filter(
      (lap) => !pitLapNumbers.has(lap.lapNumber),
    );
    const averageLapPool = cleanLaps.length > 0 ? cleanLaps : timedLaps;
    const bestLap = averageLapPool.reduce<(typeof timedLaps)[number] | null>(
      (best, lap) => {
        if (
          !best ||
          (lap.lapDuration ?? Number.POSITIVE_INFINITY) <
            (best.lapDuration ?? Number.POSITIVE_INFINITY)
        ) {
          return lap;
        }

        return best;
      },
      null,
    );

    return {
      id: driver.id,
      driverNumber: driver.driverNumber,
      acronym: driver.acronym,
      fullName: driver.fullName,
      teamName: driver.teamName,
      teamColour: driver.teamColour,
      headshotUrl: driver.headshotUrl,
      result: buildDriverResultPayload(
        driver.sessionResult,
        session.sessionType,
      ),
      stats: {
        totalLaps: driver.laps.length,
        timedLaps: timedLaps.length,
        telemetryCachedLaps: driver.laps.filter(
          (lap) => lap._count.telemetryPoints > 0,
        ).length,
        bestLapSeconds: bestLap?.lapDuration ?? null,
        averageLapSeconds:
          averageLapPool.length > 0
            ? round(
                averageLapPool.reduce(
                  (sum, lap) => sum + (lap.lapDuration ?? 0),
                  0,
                ) / averageLapPool.length,
              )
            : null,
        pitStopCount: driver.pitStops.length,
      },
      pitStops: driver.pitStops.map((pitStop) => ({
        id: pitStop.id,
        lapNumber: pitStop.lapNumber,
        date: pitStop.date,
        laneDuration: pitStop.laneDuration,
        stopDuration: pitStop.stopDuration,
        pitDuration: pitStop.pitDuration,
      })),
      stints: driver.stints.map((stint) => ({
        id: stint.id,
        stintNumber: stint.stintNumber,
        lapStart: stint.lapStart,
        lapEnd: stint.lapEnd,
        compound: stint.compound,
        tyreAgeAtStart: stint.tyreAgeAtStart,
      })),
      laps: driver.laps.map((lap) => ({
        id: lap.id,
        lapNumber: lap.lapNumber,
        lapDuration: lap.lapDuration,
        isPitOutLap: lap.isPitOutLap,
        telemetryImportedAt: lap.telemetryImportedAt,
        telemetryStatus: lap.telemetryStatus,
        telemetrySampleCount: lap._count.telemetryPoints,
        isPitLap: pitLapNumbers.has(lap.lapNumber),
        stint: lap.stint,
        tyreCompound: lap.tyreCompound,
        tyreAge: lap.tyreAge,
      })),
    };
  });

  const sortedDriverSummaries = [...driverSummaries].sort(
    compareDriverSummaries,
  );
  const [leftDriver, rightDriver] = sortedDriverSummaries;

  return {
    id: session.id,
    sessionKey: session.sessionKey,
    sessionName: session.sessionName,
    sessionType: session.sessionType,
    circuitShortName: session.circuitShortName,
    countryName: session.countryName,
    year: session.year,
    dateStart: session.dateStart,
    driverSummaries: sortedDriverSummaries,
    defaultDriverPair: {
      leftDriverId: leftDriver?.id ?? null,
      rightDriverId: rightDriver?.id ?? leftDriver?.id ?? null,
    },
  };
}

async function loadSessionOverview(sessionId: number) {
  return prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      drivers: {
        orderBy: {
          acronym: "asc",
        },
        include: {
          sessionResult: true,
          pitStops: {
            orderBy: {
              date: "asc",
            },
          },
          stints: {
            orderBy: {
              stintNumber: "asc",
            },
          },
          laps: {
            orderBy: {
              lapNumber: "asc",
            },
            include: {
              _count: {
                select: {
                  telemetryPoints: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function getLapWithRelations(lapId: number) {
  const lap = await prisma.lap.findUnique({
    where: {
      id: lapId,
    },
    include: {
      driver: true,
      session: true,
    },
  });

  if (!lap) {
    throw new HttpError(404, `Lap ${lapId} was not found.`);
  }

  return lap;
}

export async function getNextDriverLap(
  lap: Lap & { driver: Driver; session: Session },
) {
  return prisma.lap.findFirst({
    where: {
      driverId: lap.driverId,
      dateStart: {
        gt: lap.dateStart,
      },
    },
    orderBy: {
      dateStart: "asc",
    },
  });
}

async function refreshSessionDerivedData(
  prisma: Prisma.TransactionClient,
  input: {
    sessionId: number;
    sessionKey: number;
    driverByNumber: Map<number, Driver>;
    remoteResults: Awaited<ReturnType<typeof getOpenF1SessionResults>>;
    remotePitStops: Awaited<ReturnType<typeof getOpenF1PitStops>>;
    remoteStints: Awaited<ReturnType<typeof getOpenF1Stints>>;
  },
) {
  const resultRows: Prisma.SessionResultCreateManyInput[] = [];

  for (const result of input.remoteResults) {
    const driver = input.driverByNumber.get(result.driver_number);

    if (!driver) {
      continue;
    }

    resultRows.push({
      sessionId: input.sessionId,
      driverId: driver.id,
      sessionKey: result.session_key,
      driverNumber: result.driver_number,
      position: result.position,
      points: typeof result.points === "number" ? result.points : null,
      numberOfLaps: result.number_of_laps,
      dnf: result.dnf,
      dns: result.dns,
      dsq: result.dsq,
      rawDuration:
        result.duration === null
          ? Prisma.JsonNull
          : (result.duration as Prisma.InputJsonValue),
      rawGapToLeader:
        result.gap_to_leader === null
          ? Prisma.JsonNull
          : (result.gap_to_leader as Prisma.InputJsonValue),
    });
  }

  const pitRows: Prisma.PitStopCreateManyInput[] = [];

  for (const pitStop of input.remotePitStops) {
    const driver = input.driverByNumber.get(pitStop.driver_number);

    if (!driver) {
      continue;
    }

    pitRows.push({
      sessionId: input.sessionId,
      driverId: driver.id,
      sessionKey: pitStop.session_key,
      driverNumber: pitStop.driver_number,
      lapNumber: pitStop.lap_number,
      date: new Date(pitStop.date),
      laneDuration: pitStop.lane_duration,
      stopDuration: pitStop.stop_duration,
      pitDuration: pitStop.pit_duration,
    });
  }

  const stintRows: Prisma.StintCreateManyInput[] = [];

  for (const stint of input.remoteStints) {
    const driver = input.driverByNumber.get(stint.driver_number);

    if (!driver) {
      continue;
    }

    stintRows.push({
      sessionId: input.sessionId,
      driverId: driver.id,
      sessionKey: stint.session_key,
      driverNumber: stint.driver_number,
      stintNumber: stint.stint_number,
      lapStart: stint.lap_start,
      lapEnd: stint.lap_end,
      compound: stint.compound,
      tyreAgeAtStart: stint.tyre_age_at_start,
    });
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.sessionResult.deleteMany({
      where: {
        sessionId: input.sessionId,
      },
    }),
    prisma.pitStop.deleteMany({
      where: {
        sessionId: input.sessionId,
      },
    }),
    prisma.stint.deleteMany({
      where: {
        sessionId: input.sessionId,
      },
    }),
  ];

  if (resultRows.length > 0) {
    operations.push(
      prisma.sessionResult.createMany({
        data: resultRows,
      }),
    );
  }

  if (pitRows.length > 0) {
    operations.push(
      prisma.pitStop.createMany({
        data: pitRows,
      }),
    );
  }

  if (stintRows.length > 0) {
    operations.push(
      prisma.stint.createMany({
        data: stintRows,
      }),
    );
  }

  await Promise.all(operations);
}

function buildDriverResultPayload(
  sessionResult: {
    position: number | null;
    points: number | null;
    numberOfLaps: number | null;
    dnf: boolean;
    dns: boolean;
    dsq: boolean;
    rawDuration: Prisma.JsonValue | null;
    rawGapToLeader: Prisma.JsonValue | null;
  } | null,
  sessionType: string,
) {
  if (!sessionResult) {
    return {
      position: null,
      classificationLabel: "N/A",
      status: "unavailable",
      points: null,
      numberOfLaps: null,
      officialDurationText: null,
      gapToLeaderText: null,
    };
  }

  const status = sessionResult.dsq
    ? "dsq"
    : sessionResult.dns
      ? "dns"
      : sessionResult.dnf
        ? "dnf"
        : "classified";

  return {
    position: sessionResult.position,
    classificationLabel:
      status === "dsq"
        ? "DSQ"
        : status === "dns"
          ? "DNS"
          : status === "dnf"
            ? "DNF"
            : sessionResult.position !== null
              ? `P${sessionResult.position}`
              : "N/A",
    status,
    points: sessionResult.points,
    numberOfLaps: sessionResult.numberOfLaps,
    officialDurationText: formatOfficialMetric(
      sessionResult.rawDuration,
      sessionType,
      "duration",
    ),
    gapToLeaderText: formatOfficialMetric(
      sessionResult.rawGapToLeader,
      sessionType,
      "gap",
    ),
  };
}

function formatOfficialMetric(
  value: Prisma.JsonValue | null,
  sessionType: string,
  metric: "duration" | "gap",
) {
  if (value === null) {
    return null;
  }

  const normalizedValue = Array.isArray(value)
    ? ([...value].reverse().find((entry) => entry !== null) ?? null)
    : value;

  if (normalizedValue === null) {
    return null;
  }

  if (typeof normalizedValue === "string") {
    return normalizedValue;
  }

  if (typeof normalizedValue !== "number") {
    return null;
  }

  if (metric === "gap") {
    return normalizedValue === 0 ? "Leader" : `+${normalizedValue.toFixed(3)}s`;
  }

  if (sessionType === "Race") {
    return formatRaceTime(normalizedValue);
  }

  return formatLapTime(normalizedValue);
}

function compareDriverSummaries(
  left: {
    result: {
      status: string;
      position: number | null;
    };
    stats: {
      bestLapSeconds: number | null;
    };
    acronym: string;
  },
  right: {
    result: {
      status: string;
      position: number | null;
    };
    stats: {
      bestLapSeconds: number | null;
    };
    acronym: string;
  },
) {
  const leftRank = driverSortRank(left.result.status, left.result.position);
  const rightRank = driverSortRank(right.result.status, right.result.position);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftLap = left.stats.bestLapSeconds ?? Number.POSITIVE_INFINITY;
  const rightLap = right.stats.bestLapSeconds ?? Number.POSITIVE_INFINITY;

  if (leftLap !== rightLap) {
    return leftLap - rightLap;
  }

  return left.acronym.localeCompare(right.acronym);
}

function driverSortRank(status: string, position: number | null) {
  if (position !== null) {
    return position;
  }

  if (status === "dnf") {
    return 10_000 + (position ?? 0);
  }

  if (status === "dns") {
    return 20_000 + (position ?? 0);
  }

  if (status === "dsq") {
    return 30_000 + (position ?? 0);
  }

  return 40_000;
}

function formatLapTime(seconds: number) {
  const totalMilliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMilliseconds / 60_000);
  const remainingSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatRaceTime(seconds: number) {
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const remainingSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
