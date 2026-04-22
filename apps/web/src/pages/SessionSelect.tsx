import { startTransition, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getHealth, getImportedSessions, importSession, searchOpenF1Sessions } from "../lib/api";
import { getErrorMessage } from "../lib/helpers";
import type { ImportedSessionSummary, OpenF1SessionSearchResult } from "../types";

const sessionTypeOptions = ["Race", "Qualifying", "Sprint", "Sprint Qualifying"] as const;

export function SessionSelect() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<{ status: string; sessionsCount: number; lapsCount: number } | null>(null);
  const [remoteYear, setRemoteYear] = useState(2025);
  const [remoteSessionName, setRemoteSessionName] = useState<(typeof sessionTypeOptions)[number]>("Race");
  const [remoteSessions, setRemoteSessions] = useState<OpenF1SessionSearchResult[]>([]);
  const [importedSessions, setImportedSessions] = useState<ImportedSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingImportSessionKey, setLoadingImportSessionKey] = useState<number | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      setError(null);
      const [healthPayload, importedPayload] = await Promise.all([getHealth(), getImportedSessions()]);

      startTransition(() => {
        setHealth(healthPayload);
        setImportedSessions(importedPayload.sessions);
      });

      await runRemoteSearch(remoteYear, remoteSessionName);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }

  async function runRemoteSearch(year: number, sessionName: string) {
    try {
      setLoadingRemote(true);
      setError(null);
      const payload = await searchOpenF1Sessions(year, sessionName);

      startTransition(() => {
        setRemoteSessions(payload.sessions);
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingRemote(false);
    }
  }

  async function handleImportSession(sessionKey: number) {
    try {
      setLoadingImportSessionKey(sessionKey);
      setError(null);
      const result = await importSession(sessionKey);
      navigate(`/session/${result.sessionId}`);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingImportSessionKey(null);
    }
  }

  return (
    <div className="shell shell--full">
      <main className="dashboard dashboard--wide" style={{ gridColumn: "1 / -1" }}>
        <section className="hero panel" style={{ textAlign: "center", padding: "4rem 2rem" }}>
          <p className="hero__eyebrow">Formula 1 Telemetry Platform</p>
          <h2>Select a Session to Analyze</h2>
          <p style={{ margin: "0 auto" }}>Search for a race or qualifying session from the OpenF1 API, import it, and start analyzing telemetry data.</p>
          {error ? <p className="error-banner">{error}</p> : null}
        </section>

        <section className="panel">
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.5rem" }}>
            <div className="field" style={{ marginBottom: 0, minWidth: "150px" }}>
              <label>Year</label>
              <input
                type="number"
                value={remoteYear}
                onChange={(event) => setRemoteYear(Number(event.target.value))}
              />
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: "200px" }}>
              <label>Session type</label>
              <select
                value={remoteSessionName}
                onChange={(event) => setRemoteSessionName(event.target.value as (typeof sessionTypeOptions)[number])}
              >
                {sessionTypeOptions.map((sessionType) => (
                  <option value={sessionType} key={sessionType}>
                    {sessionType}
                  </option>
                ))}
              </select>
            </div>
            <button 
              type="button" 
              style={{ width: "auto", alignSelf: "flex-end", padding: "14px 24px" }}
              onClick={() => void runRemoteSearch(remoteYear, remoteSessionName)} 
              disabled={loadingRemote}
            >
              {loadingRemote ? "Searching..." : "Find Sessions"}
            </button>
          </div>
          
          <h3 className="section-title">OpenF1 F1 Results</h3>
          <div style={{ display: "flex", overflowX: "auto", gap: "1rem", paddingBottom: "1rem" }}>
            {remoteSessions.length > 0 ? remoteSessions.slice(0, 10).map((session) => (
              <article className="panel panel--dark" key={session.session_key} style={{ minWidth: "300px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ padding: "1.5rem" }}>
                  <h3 style={{ margin: "0 0 0.5rem" }}>{session.country_name}</h3>
                  <p className="muted" style={{ margin: 0 }}>{session.year} • {session.session_name}</p>
                  <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>{session.circuit_short_name}</p>
                </div>
                <div style={{ padding: "0 1.5rem 1.5rem" }}>
                  <button
                    type="button"
                    onClick={() => void handleImportSession(session.session_key)}
                    disabled={loadingImportSessionKey === session.session_key}
                  >
                    {loadingImportSessionKey === session.session_key ? "Importing..." : "Import & Select"}
                  </button>
                </div>
              </article>
            )) : <p className="muted">No sessions found for this query.</p>}
          </div>
        </section>

        {importedSessions.length > 0 ? (
          <section className="panel">
            <h3 className="section-title">Previously Imported Sessions</h3>
            <div style={{ display: "flex", overflowX: "auto", gap: "1rem", paddingBottom: "1rem" }}>
              {importedSessions.map((session) => (
                <article className="panel panel--dark" key={session.id} style={{ minWidth: "300px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div style={{ padding: "1.5rem" }}>
                    <h3 style={{ margin: "0 0 0.5rem" }}>{session.countryName}</h3>
                    <p className="muted" style={{ margin: 0 }}>{session.year} • {session.sessionName}</p>
                    <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>{session.circuitShortName}</p>
                    <div style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--sidebar-muted)" }}>
                      {session._count.drivers} drivers • {session._count.laps} laps
                    </div>
                  </div>
                  <div style={{ padding: "0 1.5rem 1.5rem" }}>
                    <button
                      type="button"
                      onClick={() => navigate(`/session/${session.id}`)}
                    >
                      Select
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
