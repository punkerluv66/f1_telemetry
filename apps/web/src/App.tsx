import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import { ChartCard } from "./components/ChartCard";
import {
  compareLaps,
  getHealth,
  getImportedSessions,
  getSessionOverview,
  importSession,
  searchOpenF1Sessions
} from "./lib/api";
import type {
  ComparisonResponse,
  DriverLapSummary,
  DriverSessionSummary,
  ImportedSessionOverview,
  ImportedSessionSummary,
  OpenF1SessionSearchResult
} from "./types";

const chartDefinitions = [
  {
    key: "speedKph",
    title: "Speed Trace",
    subtitle: "Distance-aligned velocity overlays across the selected laps.",
    unit: "km/h"
  },
  {
    key: "throttlePct",
    title: "Throttle Application",
    subtitle: "Compare exit commitment and traction management across the lap.",
    unit: "%"
  },
  {
    key: "brakePct",
    title: "Brake Pressure",
    subtitle: "See braking shape, release timing, and attack into each corner.",
    unit: "%"
  },
  {
    key: "deltaMs",
    title: "Delta Time",
    subtitle: "Negative means the right-side lap is ahead of the left-side lap.",
    unit: "ms",
    centerZero: true
  }
] as const;

const sessionTypeOptions = ["Race", "Qualifying", "Sprint", "Sprint Qualifying"] as const;

export default function App() {
  const [health, setHealth] = useState<{ status: string; sessionsCount: number; lapsCount: number } | null>(null);
  const [remoteYear, setRemoteYear] = useState(2025);
  const [remoteSessionName, setRemoteSessionName] = useState<(typeof sessionTypeOptions)[number]>("Race");
  const [remoteSessions, setRemoteSessions] = useState<OpenF1SessionSearchResult[]>([]);
  const [importedSessions, setImportedSessions] = useState<ImportedSessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [overview, setOverview] = useState<ImportedSessionOverview | null>(null);
  const [leftDriverId, setLeftDriverId] = useState<number | null>(null);
  const [rightDriverId, setRightDriverId] = useState<number | null>(null);
  const [leftLapId, setLeftLapId] = useState<number | null>(null);
  const [rightLapId, setRightLapId] = useState<number | null>(null);
  const [distanceStep, setDistanceStep] = useState(10);
  const [smoothingWindow, setSmoothingWindow] = useState(5);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [hoverDistance, setHoverDistance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [loadingImportSessionKey, setLoadingImportSessionKey] = useState<number | null>(null);

  const deferredComparison = useDeferredValue(comparison);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (selectedSessionId === null) {
      return;
    }

    void loadOverview(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    setLeftDriverId((currentDriverId) => {
      if (currentDriverId && overview.driverSummaries.some((driver) => driver.id === currentDriverId)) {
        return currentDriverId;
      }

      return overview.defaultDriverPair.leftDriverId;
    });

    setRightDriverId((currentDriverId) => {
      if (currentDriverId && overview.driverSummaries.some((driver) => driver.id === currentDriverId)) {
        return currentDriverId;
      }

      return overview.defaultDriverPair.rightDriverId;
    });
  }, [overview]);

  useEffect(() => {
    if (!overview) {
      return;
    }

    const nextLeftDriver = getDriverById(overview, leftDriverId);
    const nextRightDriver = getDriverById(overview, rightDriverId);

    setLeftLapId((currentLapId) => getPreferredLapId(nextLeftDriver, currentLapId));
    setRightLapId((currentLapId) => getPreferredLapId(nextRightDriver, currentLapId));
    setComparison(null);
    setHoverDistance(null);
  }, [overview, leftDriverId, rightDriverId]);

  async function bootstrap() {
    try {
      setError(null);
      const [healthPayload, importedPayload] = await Promise.all([getHealth(), getImportedSessions()]);

      startTransition(() => {
        setHealth(healthPayload);
        setImportedSessions(importedPayload.sessions);
        setSelectedSessionId(importedPayload.sessions[0]?.id ?? null);
      });

      await runRemoteSearch();
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    }
  }

  async function runRemoteSearch() {
    try {
      setLoadingRemote(true);
      setError(null);
      const payload = await searchOpenF1Sessions(remoteYear, remoteSessionName);

      startTransition(() => {
        setRemoteSessions(payload.sessions);
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingRemote(false);
    }
  }

  async function refreshImportedSessions(preferredSessionId?: number) {
    const payload = await getImportedSessions();

    startTransition(() => {
      setImportedSessions(payload.sessions);

      if (preferredSessionId) {
        setSelectedSessionId(preferredSessionId);
        return;
      }

      if (!selectedSessionId && payload.sessions[0]) {
        setSelectedSessionId(payload.sessions[0].id);
      }
    });
  }

  async function handleImportSession(sessionKey: number) {
    try {
      setLoadingImportSessionKey(sessionKey);
      setError(null);
      const result = await importSession(sessionKey);
      await refreshImportedSessions(result.sessionId);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingImportSessionKey(null);
    }
  }

  async function loadOverview(sessionId: number) {
    try {
      setLoadingOverview(true);
      setError(null);
      const payload = await getSessionOverview(sessionId);

      startTransition(() => {
        setOverview(payload);
        setComparison(null);
        setHoverDistance(null);
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingOverview(false);
    }
  }

  async function handleCompare() {
    if (!overview || !leftLapId || !rightLapId) {
      return;
    }

    try {
      setLoadingCompare(true);
      setError(null);
      const payload = await compareLaps({
        sessionId: overview.id,
        referenceLapId: leftLapId,
        targetLapId: rightLapId,
        distanceStep,
        smoothingWindow
      });

      startTransition(() => {
        setComparison(payload);
      });

      await refreshImportedSessions();
      await loadOverview(overview.id);
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setLoadingCompare(false);
    }
  }

  const leftDriver = overview ? getDriverById(overview, leftDriverId) : null;
  const rightDriver = overview ? getDriverById(overview, rightDriverId) : null;
  const leftLapOptions = leftDriver?.laps.filter((lap) => lap.lapDuration !== null) ?? [];
  const rightLapOptions = rightDriver?.laps.filter((lap) => lap.lapDuration !== null) ?? [];

  const selectedSessionSummary = useMemo(() => {
    if (!overview) {
      return null;
    }

    const classifiedDrivers = overview.driverSummaries.filter((driver) => driver.result.status === "classified");
    return {
      classifiedCount: classifiedDrivers.length,
      cachedTelemetryDrivers: overview.driverSummaries.filter((driver) => driver.stats.telemetryCachedLaps > 0).length,
      totalPitStops: overview.driverSummaries.reduce((sum, driver) => sum + driver.stats.pitStopCount, 0)
    };
  }, [overview]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="brand__eyebrow">CS BSc Thesis Project</p>
          <h1>Race Comparator</h1>
          <p className="brand__text">
            Choose a session, pick two drivers, compare their official result summary,
            then go lower into lap-by-lap telemetry and delta charts.
          </p>
        </div>

        <section className="panel panel--dark controls">
          <h2 className="section-title">OpenF1 Import</h2>
          <div className="field">
            <label>Year</label>
            <input
              type="number"
              value={remoteYear}
              onChange={(event) => setRemoteYear(Number(event.target.value))}
            />
          </div>
          <div className="field">
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
          <button type="button" onClick={() => void runRemoteSearch()} disabled={loadingRemote}>
            {loadingRemote ? "Searching..." : "Find Sessions"}
          </button>
          <div className="search-results">
            {remoteSessions.slice(0, 6).map((session) => (
              <article className="search-card" key={session.session_key}>
                <div>
                  <strong>
                    {session.year} {session.country_name}
                  </strong>
                  <p>
                    {session.circuit_short_name} • {session.session_name}
                  </p>
                </div>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => void handleImportSession(session.session_key)}
                  disabled={loadingImportSessionKey === session.session_key}
                >
                  {loadingImportSessionKey === session.session_key ? "Importing..." : "Import"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel--dark controls">
          <h2 className="section-title">Session</h2>
          <div className="field">
            <label>Imported session</label>
            <select
              value={selectedSessionId ?? ""}
              onChange={(event) => setSelectedSessionId(Number(event.target.value))}
            >
              {importedSessions.map((session) => (
                <option value={session.id} key={session.id}>
                  {session.year} {session.countryName} • {session.sessionName}
                </option>
              ))}
            </select>
          </div>
          <div className="meta-grid">
            <div className="meta-grid__item">
              <strong>{health?.sessionsCount ?? 0} imported sessions</strong>
              <span>{health?.lapsCount ?? 0} laps stored in PostgreSQL</span>
            </div>
          </div>
        </section>

        <section className="panel panel--dark controls">
          <h2 className="section-title">Pick Drivers</h2>
          <div className="field">
            <label>Left side driver</label>
            <select
              value={leftDriverId ?? ""}
              onChange={(event) => setLeftDriverId(Number(event.target.value))}
              disabled={!overview}
            >
              {overview?.driverSummaries.map((driver) => (
                <option value={driver.id} key={driver.id}>
                  {driver.result.classificationLabel} • {driver.acronym} • {driver.fullName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Right side driver</label>
            <select
              value={rightDriverId ?? ""}
              onChange={(event) => setRightDriverId(Number(event.target.value))}
              disabled={!overview}
            >
              {overview?.driverSummaries.map((driver) => (
                <option value={driver.id} key={driver.id}>
                  {driver.result.classificationLabel} • {driver.acronym} • {driver.fullName}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="panel panel--dark controls">
          <h2 className="section-title">Session Snapshot</h2>
          {loadingOverview ? (
            <p className="muted">Loading session from PostgreSQL...</p>
          ) : overview && selectedSessionSummary ? (
            <div className="meta-grid">
              <div className="meta-grid__item">
                <strong>
                  {overview.year} {overview.countryName}
                </strong>
                <span>
                  {overview.circuitShortName} • {overview.sessionName}
                </span>
              </div>
              <div className="meta-grid__item">
                <strong>{overview.driverSummaries.length} drivers</strong>
                <span>{selectedSessionSummary.classifiedCount} classified in the official result</span>
              </div>
              <div className="meta-grid__item">
                <strong>{selectedSessionSummary.totalPitStops} pit stops</strong>
                <span>{selectedSessionSummary.cachedTelemetryDrivers} drivers already have cached telemetry</span>
              </div>
            </div>
          ) : (
            <p className="muted">Import a race or qualifying session to begin.</p>
          )}
        </section>
      </aside>

      <main className="dashboard">
        <section className="hero panel">
          <p className="hero__eyebrow">{"Session -> Drivers -> Result -> Laps -> Telemetry"}</p>
          <h2>
            {overview
              ? `${overview.countryName} ${overview.sessionName}`
              : "Choose a race or qualifying session"}
          </h2>
          <p>
            Start with the session, select two drivers, review their official result and race
            summary side by side, then scroll down to choose specific laps and compare telemetry
            traces on the same distance axis.
          </p>
          <div className="hero__summary">
            <span className="hero__chip">
              {overview ? `${overview.driverSummaries.length} drivers loaded` : "Import a session first"}
            </span>
            <span className="hero__chip">
              {leftDriver && rightDriver
                ? `${leftDriver.acronym} vs ${rightDriver.acronym}`
                : "Pick the left and right driver"}
            </span>
            <span className="hero__chip">
              {deferredComparison
                ? `Selected lap delta ${formatDelta(deferredComparison.delta.summary.finalDeltaMs)}`
                : "Then choose laps for telemetry analysis"}
            </span>
          </div>
          {error ? <p className="error-banner">{error}</p> : null}
        </section>

        {leftDriver && rightDriver ? (
          <>
            <section className="driver-grid">
              <DriverSummaryCard
                sideLabel="Left Driver"
                driver={leftDriver}
                sessionType={overview?.sessionType ?? null}
              />
              <div className="versus-divider">VS</div>
              <DriverSummaryCard
                sideLabel="Right Driver"
                driver={rightDriver}
                sessionType={overview?.sessionType ?? null}
              />
            </section>

            <section className="panel lap-panel">
              <div className="lap-panel__header">
                <div>
                  <p className="hero__eyebrow">Lap Selection</p>
                  <h3 className="section-title">Go Deeper Into Specific Laps</h3>
                </div>
                <p className="lap-panel__text">
                  After reviewing the session result above, pick the exact lap from each driver
                  that you want to align and compare below.
                </p>
              </div>
              <div className="lap-picker-grid">
                <div className="field">
                  <label>{leftDriver.acronym} lap</label>
                  <select
                    value={leftLapId ?? ""}
                    onChange={(event) => setLeftLapId(Number(event.target.value))}
                  >
                    {leftLapOptions.map((lap) => (
                      <option key={lap.id} value={lap.id}>
                        {formatLapOption(lap)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{rightDriver.acronym} lap</label>
                  <select
                    value={rightLapId ?? ""}
                    onChange={(event) => setRightLapId(Number(event.target.value))}
                  >
                    {rightLapOptions.map((lap) => (
                      <option key={lap.id} value={lap.id}>
                        {formatLapOption(lap)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Distance step (m)</label>
                  <input
                    type="number"
                    value={distanceStep}
                    onChange={(event) => setDistanceStep(Number(event.target.value))}
                    min={5}
                    max={100}
                    step={5}
                  />
                </div>
                <div className="field">
                  <label>Smoothing window</label>
                  <input
                    type="number"
                    value={smoothingWindow}
                    onChange={(event) => setSmoothingWindow(Number(event.target.value))}
                    min={1}
                    max={21}
                    step={2}
                  />
                </div>
              </div>
              <div className="lap-panel__actions">
                <button
                  type="button"
                  onClick={() => void handleCompare()}
                  disabled={loadingCompare || !leftLapId || !rightLapId}
                >
                  {loadingCompare ? "Analyzing..." : "Compare Selected Laps"}
                </button>
              </div>
            </section>

            {deferredComparison ? (
              <>
                <section className="kpi-grid">
                  <article className="panel kpi-card">
                    <p className="kpi-card__label">{deferredComparison.referenceLap.driver.acronym} selected lap</p>
                    <p className="kpi-card__value">
                      {formatMsAsLapTime(deferredComparison.referenceLap.summary.lapTimeMs)}
                    </p>
                    <p className="kpi-card__meta">
                      peak {Math.round(deferredComparison.referenceLap.summary.topSpeedKph)} km/h • avg throttle{" "}
                      {Math.round(deferredComparison.referenceLap.summary.averageThrottlePct)}%
                    </p>
                  </article>
                  <article className="panel kpi-card">
                    <p className="kpi-card__label">{deferredComparison.targetLap.driver.acronym} selected lap</p>
                    <p className="kpi-card__value">
                      {formatMsAsLapTime(deferredComparison.targetLap.summary.lapTimeMs)}
                    </p>
                    <p className="kpi-card__meta">
                      peak {Math.round(deferredComparison.targetLap.summary.topSpeedKph)} km/h • avg throttle{" "}
                      {Math.round(deferredComparison.targetLap.summary.averageThrottlePct)}%
                    </p>
                  </article>
                  <article className="panel kpi-card">
                    <p className="kpi-card__label">Selected lap delta</p>
                    <p className="kpi-card__value">{formatDelta(deferredComparison.delta.summary.finalDeltaMs)}</p>
                    <p className="kpi-card__meta">
                      best gain {formatDelta(deferredComparison.delta.summary.bestTargetGainMs)} • biggest loss{" "}
                      {formatDelta(deferredComparison.delta.summary.biggestTargetLossMs)}
                    </p>
                  </article>
                  <article className="panel kpi-card">
                    <p className="kpi-card__label">Braking zones</p>
                    <p className="kpi-card__value">{deferredComparison.targetLap.events.length}</p>
                    <p className="kpi-card__meta">detected on the right-side selected lap</p>
                  </article>
                </section>

                <section className="chart-grid">
                  {chartDefinitions.map((definition) => {
                    const series =
                      definition.key === "deltaMs"
                        ? [
                            {
                              label: `${deferredComparison.targetLap.driver.acronym} - ${deferredComparison.referenceLap.driver.acronym}`,
                              color: "#7d3cf8",
                              points: deferredComparison.delta.points.map((point) => ({
                                distanceM: point.distanceM,
                                value: point.deltaMs
                              }))
                            }
                          ]
                        : [
                            {
                              label: `${deferredComparison.referenceLap.driver.acronym} lap`,
                              color: deferredComparison.referenceLap.driver.color,
                              points: deferredComparison.referenceLap.points.map((point) => ({
                                distanceM: point.distanceM,
                                value: point[definition.key]
                              }))
                            },
                            {
                              label: `${deferredComparison.targetLap.driver.acronym} lap`,
                              color: deferredComparison.targetLap.driver.color,
                              points: deferredComparison.targetLap.points.map((point) => ({
                                distanceM: point.distanceM,
                                value: point[definition.key]
                              }))
                            }
                          ];

                    const maxDistance = Math.max(
                      deferredComparison.referenceLap.points[deferredComparison.referenceLap.points.length - 1]?.distanceM ?? 0,
                      deferredComparison.targetLap.points[deferredComparison.targetLap.points.length - 1]?.distanceM ?? 0
                    );

                    return (
                      <ChartCard
                        key={definition.key}
                        title={definition.title}
                        subtitle={definition.subtitle}
                        unit={definition.unit}
                        series={series}
                        maxDistance={maxDistance}
                        hoverDistance={hoverDistance}
                        onHover={setHoverDistance}
                        centerZero={"centerZero" in definition ? definition.centerZero : undefined}
                        eventMarkers={deferredComparison.referenceLap.events}
                      />
                    );
                  })}
                </section>
              </>
            ) : (
              <section className="panel empty-panel">
                <h3>Telemetry layer comes next</h3>
                <ul className="feature-list">
                  <li>Pick the left and right driver from the selected session</li>
                  <li>Review position, session status, best lap, average lap, and pit stops</li>
                  <li>Choose one lap from each driver below the summary cards</li>
                  <li>Run the telemetry comparison to open the synchronized charts</li>
                </ul>
              </section>
            )}
          </>
        ) : (
          <section className="panel empty-panel">
            <h3>Start with the session and drivers</h3>
            <ul className="feature-list">
              <li>Import a race or qualifying session from OpenF1</li>
              <li>Select the session from the database</li>
              <li>Pick the two drivers you want to compare left versus right</li>
              <li>The app will then show official results, lap stats, and pit-stop summary before telemetry</li>
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function DriverSummaryCard(props: {
  sideLabel: string;
  driver: DriverSessionSummary;
  sessionType: string | null;
}) {
  return (
    <article className="panel driver-card">
      <p className="driver-card__side">{props.sideLabel}</p>
      <div className="driver-card__header">
        <div>
          <p className="driver-card__team">{props.driver.teamName}</p>
          <h3>{props.driver.fullName}</h3>
          <p className="driver-card__meta">
            #{props.driver.driverNumber} • {props.driver.acronym}
          </p>
        </div>
        <div className={`driver-card__status driver-card__status--${props.driver.result.status}`}>
          {props.driver.result.classificationLabel}
        </div>
      </div>

      <div className="driver-stat-grid">
        <div className="driver-stat">
          <span>Best lap</span>
          <strong>{formatLapTime(props.driver.stats.bestLapSeconds)}</strong>
        </div>
        <div className="driver-stat">
          <span>Average lap</span>
          <strong>{formatLapTime(props.driver.stats.averageLapSeconds)}</strong>
        </div>
        <div className="driver-stat">
          <span>{props.sessionType === "Race" ? "Laps finished" : "Timed laps"}</span>
          <strong>
            {props.driver.result.numberOfLaps ?? props.driver.stats.timedLaps}
          </strong>
        </div>
        <div className="driver-stat">
          <span>Pit stops</span>
          <strong>{props.driver.stats.pitStopCount}</strong>
        </div>
      </div>

      <div className="driver-card__detail-grid">
        <div>
          <p className="driver-card__detail-label">Official time</p>
          <p className="driver-card__detail-value">
            {props.driver.result.officialDurationText ?? "N/A"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Gap to leader</p>
          <p className="driver-card__detail-value">
            {props.driver.result.gapToLeaderText ?? "N/A"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Points</p>
          <p className="driver-card__detail-value">
            {props.driver.result.points ?? "—"}
          </p>
        </div>
        <div>
          <p className="driver-card__detail-label">Cached telemetry laps</p>
          <p className="driver-card__detail-value">
            {props.driver.stats.telemetryCachedLaps}
          </p>
        </div>
      </div>

      <div className="driver-card__pit-block">
        <p className="driver-card__detail-label">Pit stop timeline</p>
        {props.driver.pitStops.length > 0 ? (
          <ul className="pit-list">
            {props.driver.pitStops.map((pitStop) => (
              <li key={pitStop.id}>
                <strong>Lap {pitStop.lapNumber ?? "?"}</strong>
                <span>
                  {formatClockTime(pitStop.date)}
                  {pitStop.stopDuration !== null ? ` • stop ${pitStop.stopDuration.toFixed(1)}s` : ""}
                  {pitStop.laneDuration !== null ? ` • lane ${pitStop.laneDuration.toFixed(1)}s` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="driver-card__pit-empty">
            No pit stops recorded for this driver in the selected session.
          </p>
        )}
      </div>
    </article>
  );
}

function getDriverById(overview: ImportedSessionOverview, driverId: number | null) {
  if (driverId === null) {
    return null;
  }

  return overview.driverSummaries.find((driver) => driver.id === driverId) ?? null;
}

function getPreferredLapId(driver: DriverSessionSummary | null, currentLapId: number | null) {
  if (!driver) {
    return null;
  }

  if (currentLapId && driver.laps.some((lap) => lap.id === currentLapId && lap.lapDuration !== null)) {
    return currentLapId;
  }

  return getPreferredLap(driver)?.id ?? null;
}

function getPreferredLap(driver: DriverSessionSummary) {
  const cleanTimedLap = driver.laps
    .filter((lap) => lap.lapDuration !== null && !lap.isPitOutLap && !lap.isPitLap)
    .sort(compareLapDurations)[0];

  if (cleanTimedLap) {
    return cleanTimedLap;
  }

  return driver.laps
    .filter((lap) => lap.lapDuration !== null)
    .sort(compareLapDurations)[0] ?? null;
}

function compareLapDurations(left: DriverLapSummary, right: DriverLapSummary) {
  return (left.lapDuration ?? Number.POSITIVE_INFINITY) - (right.lapDuration ?? Number.POSITIVE_INFINITY);
}

function formatLapOption(lap: DriverLapSummary) {
  const tags = [
    `Lap ${lap.lapNumber}`,
    formatLapTime(lap.lapDuration),
    lap.isPitLap ? "pit lap" : null,
    lap.isPitOutLap ? "out lap" : null,
    lap.telemetrySampleCount > 0 ? "cached telemetry" : "telemetry on demand"
  ].filter((tag): tag is string => Boolean(tag));

  return tags.join(" • ");
}

function formatLapTime(seconds: number | null) {
  if (seconds === null) {
    return "N/A";
  }

  const totalMilliseconds = Math.round(seconds * 1000);
  return formatMsAsLapTime(totalMilliseconds);
}

function formatMsAsLapTime(timeMs: number) {
  const minutes = Math.floor(timeMs / 60_000);
  const seconds = Math.floor((timeMs % 60_000) / 1_000);
  const milliseconds = Math.abs(Math.round(timeMs % 1_000));

  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatDelta(deltaMs: number) {
  const seconds = (deltaMs / 1000).toFixed(3);
  return `${deltaMs > 0 ? "+" : ""}${seconds} s`;
}

function formatClockTime(dateString: string) {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected frontend error.";
}
