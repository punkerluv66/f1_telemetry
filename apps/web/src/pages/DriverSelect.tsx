import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChartCard } from "../components/ChartCard";
import { TrackMap } from "../components/TrackMap";
import { DriverSummaryCard } from "../components/DriverSummaryCard";
import { compareLaps, getSessionOverview } from "../lib/api";
import { formatDelta, formatMsAsLapTime } from "../lib/formatters";
import { getDriverById, getErrorMessage, getPreferredLapId, formatLapOption } from "../lib/helpers";
import type { ComparisonResponse, ImportedSessionOverview } from "../types";

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

export function DriverSelect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionId = id ? parseInt(id, 10) : null;

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
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingCompare, setLoadingCompare] = useState(false);

  const deferredComparison = useDeferredValue(comparison);

  useEffect(() => {
    if (!sessionId) return;
    void loadOverview(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!overview) return;
    setLeftDriverId((current) => {
      if (current && overview.driverSummaries.some((driver) => driver.id === current)) {
        return current;
      }
      return overview.defaultDriverPair.leftDriverId;
    });
    setRightDriverId((current) => {
      if (current && overview.driverSummaries.some((driver) => driver.id === current)) {
        return current;
      }
      return overview.defaultDriverPair.rightDriverId;
    });
  }, [overview]);

  useEffect(() => {
    if (!overview) return;
    const nextLeftDriver = getDriverById(overview, leftDriverId);
    const nextRightDriver = getDriverById(overview, rightDriverId);
    setLeftLapId((current) => getPreferredLapId(nextLeftDriver, current));
    setRightLapId((current) => getPreferredLapId(nextRightDriver, current));
    setComparison(null);
    setHoverDistance(null);
  }, [overview, leftDriverId, rightDriverId]);

  async function loadOverview(id: number) {
    try {
      setLoadingOverview(true);
      setError(null);
      const payload = await getSessionOverview(id);
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
    if (!overview || !leftLapId || !rightLapId) return;
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

  return (
    <div className="shell shell--full">
      <main className="dashboard dashboard--wide" style={{ gridColumn: "1 / -1" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={() => navigate("/")} className="button-secondary">
            ← Back to Sessions
          </button>
          {overview && (
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)" }}>
              {overview.year} {overview.countryName} • {overview.sessionName}
            </h2>
          )}
          <div style={{ width: "120px" }}></div>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}
        {loadingOverview ? <p className="muted">Loading session data...</p> : null}

        <section className="driver-grid">
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
             <div className="panel panel--dark controls">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Driver 1</label>
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
            </div>
            {leftDriver && (
              <DriverSummaryCard sideLabel="Driver 1" driver={leftDriver} sessionType={overview?.sessionType ?? null} />
            )}
          </div>

          <div className="versus-divider">VS</div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
             <div className="panel panel--dark controls">
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Driver 2</label>
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
            </div>
            {rightDriver && (
              <DriverSummaryCard sideLabel="Driver 2" driver={rightDriver} sessionType={overview?.sessionType ?? null} />
            )}
          </div>
        </section>

        {leftDriver && rightDriver ? (
          <section className="panel lap-panel">
            <div className="lap-panel__header">
              <div>
                <p className="hero__eyebrow">Lap Selection</p>
                <h3 className="section-title">Select Laps to Analyze</h3>
              </div>
            </div>
            <div className="lap-picker-grid">
              <div className="field">
                <label>{leftDriver.acronym} lap</label>
                <select value={leftLapId ?? ""} onChange={(event) => setLeftLapId(Number(event.target.value))}>
                  {leftLapOptions.map((lap) => (
                    <option 
                      key={lap.id} 
                      value={lap.id}
                      style={lap.lapDuration === leftDriver.stats.bestLapSeconds ? { color: "#7d3cf8", fontWeight: "bold" } : {}}
                    >
                      {lap.lapDuration === leftDriver.stats.bestLapSeconds ? "⭐ " : ""}{formatLapOption(lap)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{rightDriver.acronym} lap</label>
                <select value={rightLapId ?? ""} onChange={(event) => setRightLapId(Number(event.target.value))}>
                  {rightLapOptions.map((lap) => (
                    <option 
                      key={lap.id} 
                      value={lap.id}
                      style={lap.lapDuration === rightDriver.stats.bestLapSeconds ? { color: "#7d3cf8", fontWeight: "bold" } : {}}
                    >
                      {lap.lapDuration === rightDriver.stats.bestLapSeconds ? "⭐ " : ""}{formatLapOption(lap)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Distance step (m)</label>
                <input type="number" value={distanceStep} onChange={(event) => setDistanceStep(Number(event.target.value))} min={5} max={100} step={5} />
              </div>
              <div className="field">
                <label>Smoothing window</label>
                <input type="number" value={smoothingWindow} onChange={(event) => setSmoothingWindow(Number(event.target.value))} min={1} max={21} step={2} />
              </div>
            </div>
            <div className="lap-panel__actions">
              <button type="button" onClick={() => void handleCompare()} disabled={loadingCompare || !leftLapId || !rightLapId}>
                {loadingCompare ? "Analyzing..." : "Compare Selected Laps"}
              </button>
            </div>
          </section>
        ) : null}

        {deferredComparison ? (
          <>
            <TrackMap comparison={deferredComparison} hoverDistance={hoverDistance} />

            <section className="kpi-grid">
              <article className="panel kpi-card">
                <p className="kpi-card__label">{deferredComparison.referenceLap.driver.acronym} lap time</p>
                <p className="kpi-card__value">{formatMsAsLapTime(deferredComparison.referenceLap.summary.lapTimeMs)}</p>
              </article>
              <article className="panel kpi-card">
                <p className="kpi-card__label">{deferredComparison.targetLap.driver.acronym} lap time</p>
                <p className="kpi-card__value">{formatMsAsLapTime(deferredComparison.targetLap.summary.lapTimeMs)}</p>
              </article>
              <article className="panel kpi-card">
                <p className="kpi-card__label">Selected lap delta</p>
                <p className="kpi-card__value">{formatDelta(deferredComparison.delta.summary.finalDeltaMs)}</p>
              </article>
              <article className="panel kpi-card">
                <p className="kpi-card__label">Braking zones</p>
                <p className="kpi-card__value">{deferredComparison.targetLap.events.length}</p>
              </article>
            </section>

            <section className="chart-grid">
              {chartDefinitions.map((definition) => {
                const series = definition.key === "deltaMs" ? [
                  { label: `${deferredComparison.targetLap.driver.acronym} - ${deferredComparison.referenceLap.driver.acronym}`, color: "#7d3cf8", points: deferredComparison.delta.points.map((p) => ({ distanceM: p.distanceM, value: p.deltaMs })) }
                ] : [
                  { label: `${deferredComparison.referenceLap.driver.acronym} lap`, color: deferredComparison.referenceLap.driver.color, points: deferredComparison.referenceLap.points.map((p) => ({ distanceM: p.distanceM, value: p[definition.key] as number })) },
                  { label: `${deferredComparison.targetLap.driver.acronym} lap`, color: deferredComparison.targetLap.driver.color, points: deferredComparison.targetLap.points.map((p) => ({ distanceM: p.distanceM, value: p[definition.key] as number })) }
                ];

                const maxDistance = Math.max(
                  deferredComparison.referenceLap.points[deferredComparison.referenceLap.points.length - 1]?.distanceM ?? 0,
                  deferredComparison.targetLap.points[deferredComparison.targetLap.points.length - 1]?.distanceM ?? 0
                );

                return (
                  <ChartCard key={definition.key} title={definition.title} subtitle={definition.subtitle} unit={definition.unit} series={series} maxDistance={maxDistance} hoverDistance={hoverDistance} onHover={setHoverDistance} centerZero={"centerZero" in definition ? definition.centerZero : undefined} eventMarkers={deferredComparison.referenceLap.events} />
                );
              })}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
