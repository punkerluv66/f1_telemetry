import { z } from "zod";
import { HttpError } from "./errors.js";
import type {
  OpenF1CarDataPoint,
  OpenF1Driver,
  OpenF1Lap,
  OpenF1LocationPoint,
  OpenF1PitStop,
  OpenF1Session,
  OpenF1SessionResult,
  OpenF1Stint,
} from "../types/openf1.js";

const OPEN_F1_BASE_URL = "https://api.openf1.org/v1";
const OPEN_F1_MIN_INTERVAL_MS = 2100;
let nextOpenF1RequestAt = 0;
let requestQueue: Promise<unknown> = Promise.resolve();

async function fetchOpenF1<T>(
  endpoint: string,
  query: Record<string, string | number | undefined>,
) {
  const queryString = Object.entries(query)
    .filter((entry): entry is [string, string | number] => {
      return entry[1] !== undefined && entry[1] !== "";
    })
    .map(([key, value]) => formatQueryPart(key, value))
    .join("&");
  const requestUrl = queryString
    ? `${OPEN_F1_BASE_URL}/${endpoint}?${queryString}`
    : `${OPEN_F1_BASE_URL}/${endpoint}`;

  const response = await fetchWithRetry(requestUrl);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HttpError(502, "OpenF1 returned invalid JSON.");
  }
  const parsed = z
    .array(responseSchemas[endpoint] ?? z.object({}).passthrough())
    .safeParse(payload);
  if (!parsed.success)
    throw new HttpError(
      502,
      "OpenF1 returned invalid " + endpoint + " data. Please retry later.",
    );
  return parsed.data as T;
}

async function fetchWithRetry(
  requestUrl: string,
  attempt = 0,
): Promise<Response> {
  let response: Response;
  try {
    response = await queuedFetch(requestUrl);
  } catch {
    if (attempt < 2) {
      await sleep(1000 * 2 ** attempt);
      return fetchWithRetry(requestUrl, attempt + 1);
    }
    throw new HttpError(
      504,
      "OpenF1 could not be reached. Please retry later.",
    );
  }
  if (response.ok) return response;
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const requestedDelay = Number.isFinite(seconds)
      ? seconds * 1000
      : retryAfter
        ? Date.parse(retryAfter) - Date.now()
        : 1500 * 2 ** attempt;
    await response.body?.cancel();
    await sleep(
      Math.min(
        30_000,
        Math.max(1000, Number.isFinite(requestedDelay) ? requestedDelay : 5000),
      ),
    );
    return fetchWithRetry(requestUrl, attempt + 1);
  }
  await response.body?.cancel();
  throw new HttpError(
    response.status === 429 ? 503 : 502,
    "OpenF1 is temporarily unavailable (" +
      response.status +
      "). Please retry later.",
  );
}

function queuedFetch(url: string): Promise<Response> {
  const task = requestQueue.then(async () => {
    await sleep(Math.max(0, nextOpenF1RequestAt - Date.now()));
    nextOpenF1RequestAt = Date.now() + OPEN_F1_MIN_INTERVAL_MS;
    return fetch(url, { signal: AbortSignal.timeout(20_000) });
  });
  requestQueue = task.catch(() => undefined);
  return task;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatQueryPart(key: string, value: string | number) {
  const encodedValue = encodeURIComponent(String(value));
  return /[<>]=?$/.test(key)
    ? `${key}${encodedValue}`
    : `${key}=${encodedValue}`;
}

export async function searchOpenF1Sessions(params: {
  year?: number;
  sessionName?: string;
}) {
  const sessions = await fetchOpenF1<OpenF1Session[]>("sessions", {
    year: params.year,
    session_name: params.sessionName,
  });

  return sessions.sort((left, right) => {
    return (
      new Date(right.date_start).getTime() - new Date(left.date_start).getTime()
    );
  });
}

export async function getOpenF1SessionByKey(sessionKey: number) {
  const sessions = await fetchOpenF1<OpenF1Session[]>("sessions", {
    session_key: sessionKey,
  });

  return sessions[0] ?? null;
}

export function getOpenF1Drivers(sessionKey: number) {
  return fetchOpenF1<OpenF1Driver[]>("drivers", {
    session_key: sessionKey,
  });
}

export function getOpenF1Laps(sessionKey: number) {
  return fetchOpenF1<OpenF1Lap[]>("laps", {
    session_key: sessionKey,
  });
}

export function getOpenF1SessionResults(sessionKey: number) {
  return fetchOpenF1<OpenF1SessionResult[]>("session_result", {
    session_key: sessionKey,
  });
}

export function getOpenF1PitStops(sessionKey: number) {
  return fetchOpenF1<OpenF1PitStop[]>("pit", {
    session_key: sessionKey,
  });
}

export function getOpenF1CarData(params: {
  sessionKey: number;
  driverNumber: number;
  dateFrom: string;
  dateTo: string;
}) {
  return fetchOpenF1<OpenF1CarDataPoint[]>("car_data", {
    session_key: params.sessionKey,
    driver_number: params.driverNumber,
    "date>=": params.dateFrom,
    "date<": params.dateTo,
  });
}

export function getOpenF1Location(params: {
  sessionKey: number;
  driverNumber: number;
  dateFrom: string;
  dateTo: string;
}) {
  return fetchOpenF1<OpenF1LocationPoint[]>("location", {
    session_key: params.sessionKey,
    driver_number: params.driverNumber,
    "date>=": params.dateFrom,
    "date<": params.dateTo,
  });
}

export function getOpenF1Stints(sessionKey: number) {
  return fetchOpenF1<OpenF1Stint[]>("stints", {
    session_key: sessionKey,
  });
}

const numeric = z.number().finite();
const nullableNumber = numeric.nullish().transform((value) => value ?? null);
const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");
const identity = {
  session_key: numeric.int().positive(),
  driver_number: numeric.int().positive(),
};
const responseSchemas: Record<string, z.ZodTypeAny> = {
  sessions: z
    .object({
      session_key: numeric.int().positive(),
      meeting_key: numeric.int().positive(),
      session_type: z.string(),
      session_name: z.string(),
      date_start: timestamp,
      date_end: timestamp.nullish().transform((v) => v ?? null),
      circuit_short_name: z.string(),
      country_code: nullableString,
      country_name: z.string(),
      location: z.string(),
      gmt_offset: nullableString,
      year: numeric.int(),
    })
    .passthrough(),
  drivers: z
    .object({
      ...identity,
      full_name: z.string(),
      name_acronym: z.string(),
      team_name: z.string(),
      broadcast_name: nullableString,
      first_name: nullableString,
      last_name: nullableString,
      team_colour: nullableString,
      headshot_url: nullableString,
      country_code: nullableString,
    })
    .passthrough(),
  laps: z
    .object({
      ...identity,
      lap_number: numeric.int().positive(),
      date_start: timestamp.nullish(),
      lap_duration: nullableNumber,
      duration_sector_1: nullableNumber,
      duration_sector_2: nullableNumber,
      duration_sector_3: nullableNumber,
      i1_speed: nullableNumber,
      i2_speed: nullableNumber,
      st_speed: nullableNumber,
      is_pit_out_lap: z.boolean(),
    })
    .passthrough(),
  car_data: z
    .object({
      ...identity,
      date: timestamp,
      speed: numeric.min(0).max(450),
      throttle: numeric
        .min(0)
        .max(105)
        .transform((v) => Math.min(v, 100)),
      brake: z.union([z.literal(0), z.literal(100)]),
      n_gear: numeric.int().min(0).max(8).nullable(),
      rpm: nullableNumber,
      drs: nullableNumber,
    })
    .passthrough(),
  location: z
    .object({
      ...identity,
      date: timestamp,
      x: numeric,
      y: numeric,
      z: numeric,
    })
    .passthrough(),
  session_result: z
    .object({
      ...identity,
      position: nullableNumber,
      points: nullableNumber,
      number_of_laps: nullableNumber,
      dnf: z.boolean(),
      dns: z.boolean(),
      dsq: z.boolean(),
      duration: z
        .union([
          numeric,
          z.string(),
          z.array(z.union([numeric, z.string(), z.null()])),
        ])
        .nullish()
        .transform((v) => v ?? null),
      gap_to_leader: z
        .union([
          numeric,
          z.string(),
          z.array(z.union([numeric, z.string(), z.null()])),
        ])
        .nullish()
        .transform((v) => v ?? null),
    })
    .passthrough(),
  pit: z
    .object({
      ...identity,
      date: timestamp,
      lap_number: nullableNumber,
      lane_duration: nullableNumber,
      stop_duration: nullableNumber,
      pit_duration: nullableNumber,
    })
    .passthrough(),
  stints: z
    .object({
      ...identity,
      stint_number: numeric.int(),
      lap_start: numeric.int(),
      lap_end: numeric.int(),
      compound: nullableString,
      tyre_age_at_start: nullableNumber,
    })
    .passthrough(),
};
