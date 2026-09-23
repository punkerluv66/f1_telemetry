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
  const [view, setView] = useState<"saved" | "archive">("saved");
  const [query, setQuery] = useState("");
  const filteredSessions = sessions.filter((session) =>
    `${session.country_name} ${session.circuit_short_name}`
      .toLowerCase().includes(query.trim().toLowerCase()),
  );
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
    setQuery("");
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
            <p className="eyebrow">Your workspace</p>
            <h1>Session library</h1>
            <p className="muted">
              Select a session to compare drivers and laps.
            </p>
          </div>
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
        <nav className="library-navigation" aria-label="Session library views">
          <button type="button" aria-pressed={view === "saved"} onClick={() => setView("saved")}>
            Saved sessions <span>{imported.length}</span>
          </button>
          <button type="button" aria-pressed={view === "archive"} onClick={() => setView("archive")}>
            Find a session
          </button>
        </nav>
        <div className="session-browser">
          <section hidden={view !== "saved"} className="panel session-section library-saved">
            <div className="section-header">
              <div><h2>Ready to analyse</h2><p className="muted">Open a session and select your driver pair.</p></div>
              <span className="muted">{imported.length} saved locally</span>
            </div>
            <div className="session-register" role="region" aria-label="saved sessions">
              {imported.map((session) => (
                <Link
                  className="saved-session"
                  key={session.id}
                  to={"/session/" + session.id}
                >
                  <span className="eyebrow">
                    {session.year} · {session.sessionName}
                  </span>
                  <h3>{session.circuitShortName}</h3>
                  <p className="muted">{session.countryName}</p>
                  <span className="session-link">Analyse <span aria-hidden="true">↗</span></span>
                </Link>
              ))}
            </div>
            {!loadingSaved && imported.length === 0 && <div className="library-empty"><p>Your library is empty.</p><button type="button" onClick={() => setView("archive")}>Find your first session</button></div>}
          </section>
        <section hidden={view !== "archive"} className="panel session-section library-import">
          <div className="section-header">
            <div>
              <h2>Find a session</h2>
              <p className="muted">
                Search the OpenF1 archive. Coverage starts in 2023.
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
              <select
                id="year"
                required
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
              >
                {Array.from({ length: new Date().getFullYear() - 2022 }, (_, index) => new Date().getFullYear() - index)
                  .map((season) => <option key={season} value={season}>{season}</option>)}
              </select>
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
            <div className="session-search-results" role="region" aria-label="available sessions">
              <div className="archive-results-toolbar">
                <p className="session-search-results__count" role="status">{filteredSessions.length} of {sessions.length} sessions</p>
                <label className="archive-filter">
                  Filter results
                  <input type="search" placeholder="Search circuit or country" value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
              </div>
              <div className="archive-columns" aria-hidden="true"><span>Grand Prix / circuit</span><span>Session</span><span>Status</span><span /></div>
              {filteredSessions.map((session) => {
                const saved = imported.some(
                  (item) => item.sessionKey === session.session_key,
                );
                return (
                  <article
                    className="archive-row"
                    key={session.session_key}
                  >
                    <div>
                      <h3>{session.country_name}</h3>
                      <p className="muted">{session.circuit_short_name}</p>
                    </div>
                    <span className="archive-row__session">{session.year} · {session.session_name}</span>
                    <span className={"archive-row__status" + (saved ? " is-saved" : "")}>{saved ? "Saved" : "Not imported"}</span>
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
              {filteredSessions.length === 0 && <p className="empty-state">No matching circuit or country. Try another name.</p>}
            </div>
          )}
          {!sessions.length && (
            <p className="empty-state">
              {searching
                ? "Searching OpenF1…"
                : searched
                  ? "No sessions found. Try a different season or session type."
                  : "Select a season and session type, then search."}
            </p>
          )}
        </section>
        </div>
        <p className="page-footnote">
          Telemetry is loaded only for the laps you compare and cached for
          future visits.
        </p>
      </main>
    </div>
  );
}
