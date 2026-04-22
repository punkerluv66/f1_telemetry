import type { Driver, Lap, Session } from "@prisma/client";
import { Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import {
  getOpenF1Drivers,
  getOpenF1Laps,
  getOpenF1PitStops,
  getOpenF1SessionByKey,
  getOpenF1SessionResults
} from "../lib/openf1.js";

export async function importSessionMetadata(sessionKey: number) {
  const remoteSession = await getOpenF1SessionByKey(sessionKey);

  if (!remoteSession) {
    throw new Error(`OpenF1 session ${sessionKey} was not found.`);
  }

  const [remoteDrivers, remoteLaps, remoteResults, remotePitStops] = await Promise.all([
    getOpenF1Drivers(sessionKey),
    getOpenF1Laps(sessionKey),
    getOpenF1SessionResults(sessionKey),
    getOpenF1PitStops(sessionKey)
  ]);

  const session = await prisma.session.upsert({
    where: {
      sessionKey
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
      dateEnd: remoteSession.date_end ? new Date(remoteSession.date_end) : null
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
      dateEnd: remoteSession.date_end ? new Date(remoteSession.date_end) : null
    }
  });

  for (const remoteDriver of remoteDrivers) {
    await prisma.driver.upsert({
      where: {
        sessionId_driverNumber: {
          sessionId: session.id,
          driverNumber: remoteDriver.driver_number
        }
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
        countryCode: remoteDriver.country_code
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
        countryCode: remoteDriver.country_code
      }
    });
  }

  const drivers = await prisma.driver.findMany({
    where: {
      sessionId: session.id
    }
  });
  const driverByNumber = new Map<number, Driver>(drivers.map((driver) => [driver.driverNumber, driver]));

  for (const remoteLap of remoteLaps) {
    const driver = driverByNumber.get(remoteLap.driver_number);

    if (!driver || !remoteLap.date_start) {
      continue;
    }

    await prisma.lap.upsert({
      where: {
        sessionId_driverId_lapNumber: {
          sessionId: session.id,
          driverId: driver.id,
          lapNumber: remoteLap.lap_number
        }
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
        isPitOutLap: remoteLap.is_pit_out_lap
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
        isPitOutLap: remoteLap.is_pit_out_lap
      }
    });
  }

  const importedLaps = await prisma.lap.count({
    where: {
      sessionId: session.id
    }
  });

  await refreshSessionDerivedData({
    sessionId: session.id,
    sessionKey: session.sessionKey,
    driverByNumber,
    remoteResults,
    remotePitStops
  });

  return {
    sessionId: session.id,
    sessionKey: session.sessionKey,
    driversImported: remoteDrivers.length,
    lapsImported: importedLaps
  };
}

export function listImportedSessions() {
  return prisma.session.findMany({
    orderBy: {
      dateStart: "desc"
    },
    include: {
      _count: {
        select: {
          drivers: true,
          laps: true
        }
      }
    }
  });
}

export async function getSessionOverview(sessionId: number) {
  let session = await loadSessionOverview(sessionId);

  if (!session) {
    throw new Error(`Imported session ${sessionId} was not found in the database.`);
  }

  const shouldBackfillResults =
    session.drivers.some((driver) => driver.sessionResult === null) &&
    ["Qualifying", "Race", "Sprint", "Sprint Qualifying"].includes(session.sessionType);
  const shouldBackfillPitStops =
    session.sessionType === "Race" &&
    session.drivers.every((driver) => driver.pitStops.length === 0);

  if (shouldBackfillResults || shouldBackfillPitStops) {
    const driverByNumber = new Map<number, Driver>(
      session.drivers.map((driver) => [
        driver.driverNumber,
        {
          id: driver.id,
          sessionId: driver.sessionId,
          sessionKey: driver.sessionKey,
          driverNumber: driver.driverNumber,
          broadcastName: driver.broadcastName,
          fullName: driver.fullName,
          firstName: driver.firstName,
          lastName: driver.lastName,
          acronym: driver.acronym,
          teamName: driver.teamName,
          teamColour: driver.teamColour,
          headshotUrl: driver.headshotUrl,
          countryCode: driver.countryCode,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt
        }
      ])
    );

    const [remoteResults, remotePitStops] = await Promise.all([
      shouldBackfillResults ? getOpenF1SessionResults(session.sessionKey) : Promise.resolve([]),
      shouldBackfillPitStops ? getOpenF1PitStops(session.sessionKey) : Promise.resolve([])
    ]);

    await refreshSessionDerivedData({
      sessionId: session.id,
      sessionKey: session.sessionKey,
      driverByNumber,
      remoteResults,
      remotePitStops
    });

    session = await loadSessionOverview(sessionId);
  }

  if (!session) {
    throw new Error(`Imported session ${sessionId} was not found in the database.`);
  }

  const driverSummaries = session.drivers.map((driver) => {
    const pitLapNumbers = new Set(
      driver.pitStops
        .map((pitStop) => pitStop.lapNumber)
        .filter((lapNumber): lapNumber is number => lapNumber !== null)
    );
    const timedLaps = driver.laps.filter((lap) => lap.lapDuration !== null && !lap.isPitOutLap);
    const cleanLaps = timedLaps.filter((lap) => !pitLapNumbers.has(lap.lapNumber));
    const averageLapPool = cleanLaps.length > 0 ? cleanLaps : timedLaps;
    const bestLap = timedLaps.reduce<(typeof timedLaps)[number] | null>((best, lap) => {
      if (!best || (lap.lapDuration ?? Number.POSITIVE_INFINITY) < (best.lapDuration ?? Number.POSITIVE_INFINITY)) {
        return lap;
      }

      return best;
    }, null);

    return {
      id: driver.id,
      driverNumber: driver.driverNumber,
      acronym: driver.acronym,
      fullName: driver.fullName,
      teamName: driver.teamName,
      teamColour: driver.teamColour,
      headshotUrl: driver.headshotUrl,
      result: buildDriverResultPayload(driver.sessionResult, session.sessionType),
      stats: {
        totalLaps: driver.laps.length,
        timedLaps: timedLaps.length,
        telemetryCachedLaps: driver.laps.filter((lap) => lap._count.telemetryPoints > 0).length,
        bestLapSeconds: bestLap?.lapDuration ?? null,
        averageLapSeconds:
          averageLapPool.length > 0
            ? round(
                averageLapPool.reduce((sum, lap) => sum + (lap.lapDuration ?? 0), 0) /
                  averageLapPool.length
              )
            : null,
        pitStopCount: driver.pitStops.length
      },
      pitStops: driver.pitStops.map((pitStop) => ({
        id: pitStop.id,
        lapNumber: pitStop.lapNumber,
        date: pitStop.date,
        laneDuration: pitStop.laneDuration,
        stopDuration: pitStop.stopDuration,
        pitDuration: pitStop.pitDuration
      })),
      laps: driver.laps.map((lap) => ({
        id: lap.id,
        lapNumber: lap.lapNumber,
        lapDuration: lap.lapDuration,
        isPitOutLap: lap.isPitOutLap,
        telemetryImportedAt: lap.telemetryImportedAt,
        telemetryStatus: lap.telemetryStatus,
        telemetrySampleCount: lap._count.telemetryPoints,
        isPitLap: pitLapNumbers.has(lap.lapNumber)
      }))
    };
  });

  const sortedDriverSummaries = [...driverSummaries].sort(compareDriverSummaries);
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
      rightDriverId: rightDriver?.id ?? leftDriver?.id ?? null
    }
  };
}

async function loadSessionOverview(sessionId: number) {
  return prisma.session.findUnique({
    where: {
      id: sessionId
    },
    include: {
      drivers: {
        orderBy: {
          acronym: "asc"
        },
        include: {
          sessionResult: true,
          pitStops: {
            orderBy: {
              date: "asc"
            }
          },
          laps: {
            orderBy: {
              lapNumber: "asc"
            },
            include: {
              _count: {
                select: {
                  telemetryPoints: true
                }
              }
            }
          }
        }
      }
    }
  });
}

export async function getLapWithRelations(lapId: number) {
  const lap = await prisma.lap.findUnique({
    where: {
      id: lapId
    },
    include: {
      driver: true,
      session: true
    }
  });

  if (!lap) {
    throw new Error(`Lap ${lapId} was not found.`);
  }

  return lap;
}

export async function getNextDriverLap(lap: Lap & { driver: Driver; session: Session }) {
  return prisma.lap.findFirst({
    where: {
      driverId: lap.driverId,
      dateStart: {
        gt: lap.dateStart
      }
    },
    orderBy: {
      dateStart: "asc"
    }
  });
}

async function refreshSessionDerivedData(input: {
  sessionId: number;
  sessionKey: number;
  driverByNumber: Map<number, Driver>;
  remoteResults: Awaited<ReturnType<typeof getOpenF1SessionResults>>;
  remotePitStops: Awaited<ReturnType<typeof getOpenF1PitStops>>;
}) {
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
      rawDuration: result.duration === null ? Prisma.JsonNull : (result.duration as Prisma.InputJsonValue),
      rawGapToLeader:
        result.gap_to_leader === null
          ? Prisma.JsonNull
          : (result.gap_to_leader as Prisma.InputJsonValue)
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
      pitDuration: pitStop.pit_duration
    });
  }

  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.sessionResult.deleteMany({
      where: {
        sessionId: input.sessionId
      }
    }),
    prisma.pitStop.deleteMany({
      where: {
        sessionId: input.sessionId
      }
    })
  ];

  if (resultRows.length > 0) {
    operations.push(
      prisma.sessionResult.createMany({
        data: resultRows
      })
    );
  }

  if (pitRows.length > 0) {
    operations.push(
      prisma.pitStop.createMany({
        data: pitRows
      })
    );
  }

  await prisma.$transaction(operations);
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
  sessionType: string
) {
  if (!sessionResult) {
    return {
      position: null,
      classificationLabel: "N/A",
      status: "unavailable",
      points: null,
      numberOfLaps: null,
      officialDurationText: null,
      gapToLeaderText: null
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
    officialDurationText: formatOfficialMetric(sessionResult.rawDuration, sessionType, "duration"),
    gapToLeaderText: formatOfficialMetric(sessionResult.rawGapToLeader, sessionType, "gap")
  };
}

function formatOfficialMetric(
  value: Prisma.JsonValue | null,
  sessionType: string,
  metric: "duration" | "gap"
) {
  if (value === null) {
    return null;
  }

  const normalizedValue = Array.isArray(value)
    ? [...value].reverse().find((entry) => entry !== null) ?? null
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
  }
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
  if (status === "classified" && position !== null) {
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
