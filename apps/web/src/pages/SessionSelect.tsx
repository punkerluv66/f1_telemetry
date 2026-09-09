import { CardRail } from "../components/CardRail";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getImportedSessions,
  importSession,
  searchOpenF1Sessions,
} from "../lib/api";
import { getErrorMessage } from "../lib/helpers";
import type {
  ImportedSessionSummary,
  OpenF1SessionSearchResult,
} from "../types";

export function SessionSelect() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [kind, setKind] = useState("Qualifying");
  const [sessions, setSessions] = useState<OpenF1SessionSearchResult[]>([]);
  const [imported, setImported] = useState<ImportedSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const searchRequest = useRef<AbortController | null>(null);
  const importRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getImportedSessions(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setImported(data.sessions);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSaved(false);
      });
    return () => {
      controller.abort();
      searchRequest.current?.abort();
      importRequest.current?.abort();
    };
  }, []);
  async function search() {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setSearching(true);
    setError(null);
    setSessions([]);
    try {
      const data = await searchOpenF1Sessions(year, kind, controller.signal);
      if (!controller.signal.aborted) {
        setSessions(data.sessions);
        setSearched(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(getErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }
  async function openSession(key: number) {
    const saved = imported.find((session) => session.sessionKey === key);
    if (saved) {
      navigate("/session/" + saved.id);
      return;
    }
    if (importRequest.current && !importRequest.current.signal.aborted) return;
    const controller = new AbortController();
    importRequest.current = controller;
    setImporting(key);
    setError(null);
    try {
      const result = await importSession(key, controller.signal);
      if (!controller.signal.aborted) navigate("/session/" + result.sessionId);
    } catch (error) {
      if (!controller.signal.aborted) setError(getErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setImporting(null);
      if (importRequest.current === controller) importRequest.current = null;
    }
  }
  return (
    <div className="shell shell--full">
      <main className="dashboard session-page">
        <header className="page-header">
          <div>
            <p className="eyebrow">F1 / TELEMETRY</p>
            <h1>Every lap tells a story.</h1>
            <p className="muted">
              Compare two laps. See where time is gained and lost.
            </p>
          </div>
          <span className="app-mark">SESSION LIBRARY</span>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}
        {loadingSaved && (
          <p role="status" className="muted">
            Loading saved sessions…
          </p>
        )}
        {imported.length > 0 && (
          <section className="panel session-section">
            <div className="section-header">
              <h2>Your sessions</h2>
              <span className="muted">{imported.length} saved locally</span>
            </div>
            <CardRail label="saved sessions">
              {imported.map((session) => (
                <Link
                  className="saved-session"
                  key={session.id}
                  to={"/session/" + session.id}
                >
                  <span className="eyebrow">
                    {session.year} · {session.sessionName}
                  </span>
                  <h3>{session.countryName}</h3>
                  <p className="muted">{session.circuitShortName}</p>
                  <span className="session-badge">Saved locally</span>
                  <span className="session-link">Choose drivers →</span>
                </Link>
              ))}
            </CardRail>
          </section>
        )}
        <section className="panel session-section">
          <div className="section-header">
            <div>
              <h2>Find a session</h2>
              <p className="muted">
                Historical telemetry from OpenF1, available from 2023.
              </p>
            </div>
          </div>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <label htmlFor="year">
              Season
              <input
                id="year"
                type="number"
                min={2023}
                max={new Date().getFullYear()}
                required
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              />
            </label>
            <label htmlFor="kind">
              Session
              <select
                id="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                {["Qualifying", "Race", "Sprint", "Sprint Qualifying"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <button disabled={searching || importing !== null}>
              {searching ? "Searching…" : "Find sessions"}
            </button>
          </form>
          {importing !== null && (
            <p className="loading-note" role="status">
              Importing session metadata. This may take a moment.
            </p>
          )}
          {sessions.length > 0 && (
            <CardRail label="available sessions">
              {sessions.map((session) => {
                const saved = imported.some(
                  (item) => item.sessionKey === session.session_key,
                );
                return (
                  <article
                    className="session-import-card"
                    key={session.session_key}
                  >
                    <div>
                      <p className="eyebrow">
                        {session.year} · {session.session_name}
                      </p>
                      <h3>{session.country_name}</h3>
                      <p className="muted">{session.circuit_short_name}</p>
                    </div>
                    <span
                      className={"session-badge" + (saved ? " is-saved" : "")}
                    >
                      {saved ? "Saved locally" : "Available to import"}
                    </span>
                    <button
                      className="button-secondary"
                      disabled={importing !== null}
                      onClick={() => void openSession(session.session_key)}
                    >
                      {importing === session.session_key
                        ? "Importing…"
                        : saved
                          ? "Open"
                          : "Import & open"}
                    </button>
                  </article>
                );
              })}
            </CardRail>
          )}
          {!sessions.length && (
            <p className="empty-state">
              {searching
                ? "Searching OpenF1…"
                : searched
                  ? "No sessions found. Try a different season or session type."
                  : "Choose a season and session type to get started."}
            </p>
          )}
        </section>
        <p className="page-footnote">
          Telemetry is loaded only for the laps you compare and cached for
          future visits.
        </p>
      </main>
    </div>
  );
}
