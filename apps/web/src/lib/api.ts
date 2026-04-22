import type {
  ComparisonResponse,
  ImportedSessionOverview,
  ImportedSessionSummary,
  OpenF1SessionSearchResult
} from "../types";

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T | { error: string };

  if (!response.ok) {
    if (typeof payload === "object" && payload !== null && "error" in payload) {
      throw new Error(payload.error);
    }

    throw new Error("Unexpected API error.");
  }

  return payload as T;
}

export function getHealth() {
  return requestJson<{ status: string; sessionsCount: number; lapsCount: number }>("/api/health");
}

export function searchOpenF1Sessions(year: number, sessionName: string) {
  return requestJson<{ sessions: OpenF1SessionSearchResult[] }>(
    `/api/openf1/sessions?year=${year}&sessionName=${encodeURIComponent(sessionName)}`
  );
}

export function importSession(sessionKey: number) {
  return requestJson<{
    sessionId: number;
    sessionKey: number;
    driversImported: number;
    lapsImported: number;
  }>("/api/sessions/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionKey
    })
  });
}

export function getImportedSessions() {
  return requestJson<{ sessions: ImportedSessionSummary[] }>("/api/sessions");
}

export function getSessionOverview(sessionId: number) {
  return requestJson<ImportedSessionOverview>(`/api/sessions/${sessionId}/overview`);
}

export function compareLaps(payload: {
  sessionId: number;
  referenceLapId: number;
  targetLapId: number;
  distanceStep: number;
  smoothingWindow: number;
}) {
  return requestJson<ComparisonResponse>("/api/analysis/compare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
