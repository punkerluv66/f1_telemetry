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
      <main className="dashboard dashboard--wide session-page">
        <section className="hero panel session-hero">
          <p className="hero__eyebrow">Formula 1 Telemetry Platform</p>
          <h2>Select a Session to Analyze</h2>
          <p>
            Search for a race or qualifying session from the OpenF1 API, import it,
            and start analyzing telemetry data.
          </p>
          <div className="session-hero__metrics">
            <div className="session-metric">
              <strong>{health?.sessionsCount ?? 0}</strong>
              <span>Imported sessions</span>
            </div>
            <div className="session-metric">
              <strong>{health?.lapsCount ?? 0}</strong>
              <span>Laps stored locally</span>
            </div>
            <div className="session-metric">
              <strong>{remoteSessions.length}</strong>
              <span>Search matches loaded</span>
            </div>
          </div>
          {error ? <p className="error-banner">{error}</p> : null}
        </section>

        <section className="panel session-section">
          <div className="session-section__header">
            <div>
              <h3 className="section-title">OpenF1 F1 Results</h3>
              <p className="muted">Use a simple filter, then import the session you want to inspect.</p>
            </div>
            <p className="muted">Showing {remoteSessions.length} sessions</p>
          </div>

          <div className="session-filter-bar">
            <div className="field session-filter">
              <label>Year</label>
              <input
                type="number"
                value={remoteYear}
                onChange={(event) => setRemoteYear(Number(event.target.value))}
              />
            </div>
            <div className="field session-filter session-filter--wide">
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
            <div className="session-filter-bar__action">
              <button
                type="button"
                onClick={() => void runRemoteSearch(remoteYear, remoteSessionName)}
                disabled={loadingRemote}
              >
                {loadingRemote ? "Searching..." : "Find Sessions"}
              </button>
            </div>
          </div>

          <div className="session-card-rail">
            {remoteSessions.length > 0 ? remoteSessions.map((session) => (
              <article className="panel panel--dark session-card" key={session.session_key}>
                <div className="session-card__content">
                  <h3 className="session-card__title">{session.country_name}</h3>
                  <p className="session-card__meta">{session.year} - {session.session_name}</p>
                  <p className="session-card__circuit">{session.circuit_short_name}</p>
                </div>
                <div className="session-card__actions">
                  <button
                    type="button"
                    onClick={() => void handleImportSession(session.session_key)}
                    disabled={loadingImportSessionKey === session.session_key}
                  >
                    {loadingImportSessionKey === session.session_key ? "Importing..." : "Import & Select"}
                  </button>
                </div>
              </article>
            )) : (
              <div className="session-empty">
                <p className="muted">No sessions found for this query.</p>
              </div>
            )}
          </div>
        </section>

        {importedSessions.length > 0 ? (
          <section className="panel session-section">
            <div className="session-section__header">
              <div>
                <h3 className="section-title">Previously Imported Sessions</h3>
                <p className="muted">Jump back into sessions already cached in your local database.</p>
              </div>
              <p className="muted">{importedSessions.length} sessions available</p>
            </div>

            <div className="session-card-rail">
              {importedSessions.map((session) => (
                <article className="panel panel--dark session-card" key={session.id}>
                  <div className="session-card__content">
                    <h3 className="session-card__title">{session.countryName}</h3>
                    <p className="session-card__meta">{session.year} - {session.sessionName}</p>
                    <p className="session-card__circuit">{session.circuitShortName}</p>
                    <p className="session-card__stats">
                      {session._count.drivers} drivers - {session._count.laps} laps
                    </p>
                  </div>
                  <div className="session-card__actions">
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
