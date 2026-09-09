import type {
  ComparisonResponse,
  ImportedSessionOverview,
  ImportedSessionSummary,
  OpenF1SessionSearchResult,
} from "../types";

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(180_000)])
        : AbortSignal.timeout(180_000),
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error(
      "The server could not be reached or the request timed out. Check that the API is running, then retry.",
    );
  }
  let payload: T | { error: string };
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Please retry.",
    );
  }

  if (!response.ok) {
    if (typeof payload === "object" && payload !== null && "error" in payload) {
      throw new Error(payload.error);
    }

    throw new Error("Unexpected API error.");
  }

  return payload as T;
}

export function getHealth() {
  return requestJson<{
    status: string;
    sessionsCount: number;
    lapsCount: number;
  }>("/api/health");
}

export function searchOpenF1Sessions(
  year: number,
  sessionName: string,
  signal?: AbortSignal,
) {
  return requestJson<{ sessions: OpenF1SessionSearchResult[] }>(
    `/api/openf1/sessions?year=${year}&sessionName=${encodeURIComponent(sessionName)}`,
    { signal },
  );
}

export function importSession(sessionKey: number, signal?: AbortSignal) {
  return requestJson<{
    sessionId: number;
    sessionKey: number;
    driversImported: number;
    lapsImported: number;
  }>("/api/sessions/import", {
    signal,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sessionKey,
    }),
  });
}

export function getImportedSessions(signal?: AbortSignal) {
  return requestJson<{ sessions: ImportedSessionSummary[] }>("/api/sessions", {
    signal,
  });
}

export function getSessionOverview(sessionId: number, signal?: AbortSignal) {
  return requestJson<ImportedSessionOverview>(
    `/api/sessions/${sessionId}/overview`,
    { signal },
  );
}

export async function compareLaps(
  payload: {
    sessionId: number;
    referenceLapId: number;
    targetLapId: number;
    distanceStep: number;
    smoothingWindow: number;
  },
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
) {
  if (onProgress) {
    const response = await fetch("/api/analysis/compare", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
        : AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? "Unable to compare laps.");
    }
    if (!response.body)
      throw new Error("The server returned an empty response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const stages: Record<string, string> = {
      queued: "Waiting for analysis…",
      loading: "Loading telemetry…",
      calculating: "Calculating comparison…",
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "progress")
            onProgress(stages[event.stage] ?? "Processing comparison…");
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "result")
            return event.result as ComparisonResponse;
        }
        if (done)
          throw new Error(
            "The comparison response was interrupted. Please retry.",
          );
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return requestJson<ComparisonResponse>("/api/analysis/compare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify(payload),
  });
}
