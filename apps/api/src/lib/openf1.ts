import type {
  OpenF1CarDataPoint,
  OpenF1Driver,
  OpenF1Lap,
  OpenF1LocationPoint,
  OpenF1PitStop,
  OpenF1Session,
  OpenF1SessionResult
} from "../types/openf1.js";

const OPEN_F1_BASE_URL = "https://api.openf1.org/v1";
const OPEN_F1_MIN_INTERVAL_MS = 2100;
let nextOpenF1RequestAt = 0;

async function fetchOpenF1<T>(endpoint: string, query: Record<string, string | number | undefined>) {
  const queryString = Object.entries(query)
    .filter((entry): entry is [string, string | number] => {
      return entry[1] !== undefined && entry[1] !== "";
    })
    .map(([key, value]) => formatQueryPart(key, value))
    .join("&");
  const requestUrl = queryString
    ? `${OPEN_F1_BASE_URL}/${endpoint}?${queryString}`
    : `${OPEN_F1_BASE_URL}/${endpoint}`;

  await throttleOpenF1Requests();

  const response = await fetchWithRetry(requestUrl);
  const payload = await response.json();
  return (Array.isArray(payload) ? payload : []) as T;
}

async function fetchWithRetry(requestUrl: string, attempt = 0): Promise<Response> {
  const response = await fetch(requestUrl);

  if (response.ok) {
    return response;
  }

  if (response.status === 429 && attempt < 4) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryDelayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 15_000;

    await sleep(Number.isFinite(retryDelayMs) ? retryDelayMs : 15_000);
    return fetchWithRetry(requestUrl, attempt + 1);
  }

  throw new Error(
    `OpenF1 request failed for ${requestUrl} with ${response.status} ${response.statusText}.`
  );
}

async function throttleOpenF1Requests() {
  const now = Date.now();
  const waitMs = Math.max(0, nextOpenF1RequestAt - now);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextOpenF1RequestAt = Date.now() + OPEN_F1_MIN_INTERVAL_MS;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatQueryPart(key: string, value: string | number) {
  const encodedValue = encodeURIComponent(String(value));
  return /[<>]=?$/.test(key) ? `${key}${encodedValue}` : `${key}=${encodedValue}`;
}

export async function searchOpenF1Sessions(params: {
  year?: number;
  sessionName?: string;
}) {
  const sessions = await fetchOpenF1<OpenF1Session[]>("sessions", {
    year: params.year,
    session_name: params.sessionName
  });

  return sessions.sort((left, right) => {
    return new Date(right.date_start).getTime() - new Date(left.date_start).getTime();
  });
}

export async function getOpenF1SessionByKey(sessionKey: number) {
  const sessions = await fetchOpenF1<OpenF1Session[]>("sessions", {
    session_key: sessionKey
  });

  return sessions[0] ?? null;
}

export function getOpenF1Drivers(sessionKey: number) {
  return fetchOpenF1<OpenF1Driver[]>("drivers", {
    session_key: sessionKey
  });
}

export function getOpenF1Laps(sessionKey: number) {
  return fetchOpenF1<OpenF1Lap[]>("laps", {
    session_key: sessionKey
  });
}

export function getOpenF1SessionResults(sessionKey: number) {
  return fetchOpenF1<OpenF1SessionResult[]>("session_result", {
    session_key: sessionKey
  });
}

export function getOpenF1PitStops(sessionKey: number) {
  return fetchOpenF1<OpenF1PitStop[]>("pit", {
    session_key: sessionKey
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
    "date<": params.dateTo
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
    "date<": params.dateTo
  });
}
