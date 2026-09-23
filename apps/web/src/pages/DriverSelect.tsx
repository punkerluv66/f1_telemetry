import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DriverPicker } from "../components/DriverPicker";
import { MiniSectorPanel } from "../components/MiniSectorPanel";
import { ChartCard } from "../components/ChartCard";
import { CornerAnalysisPanel } from "../components/CornerAnalysisPanel";
import { TrackMap } from "../components/TrackMap";
import { EngineerReportPanel } from "../components/EngineerReportPanel";
import { StintPerformancePanel } from "../components/StintPerformancePanel";
import { compareLaps, getSessionOverview } from "../lib/api";
import { formatDelta, formatLapTime } from "../lib/formatters";
import {
  getDriverById,
  getErrorMessage,
  getPreferredLapId,
} from "../lib/helpers";
import type { ComparisonResponse, ImportedSessionOverview } from "../types";

export function DriverSelect() {
  const { id } = useParams();
  const sessionId = Number(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState<ImportedSessionOverview | null>(
    null,
  );
  const [driversExpanded, setDriversExpanded] = useState(true);
  const [distanceStep, setDistanceStep] = useState(10);
  const [smoothingWindow, setSmoothingWindow] = useState(3);
  const [comparison, setComparison] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [progress, setProgress] = useState("Preparing comparison…");
  const [linkMessage, setLinkMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setOverview(null);
    setComparison(null);
    setDriversExpanded(true);
    setComparing(false);
    setLoading(true);
    setError(null);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      setError("Invalid session address.");
      setLoading(false);
      return;
    }
    getSessionOverview(sessionId, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setOverview(payload);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
      requestVersion.current++;
    };
  }, [sessionId]);

  const leftDriver =
    overview?.driverSummaries.find(
      (driver) => driver.driverNumber === Number(searchParams.get("left")),
    ) ?? null;
  const rightDriver =
    overview?.driverSummaries.find(
      (driver) => driver.driverNumber === Number(searchParams.get("right")),
    ) ?? null;
  const leftDriverId = leftDriver?.id ?? null;
  const rightDriverId = rightDriver?.id ?? null;
  const race = !!overview && ["Race", "Sprint"].includes(overview.sessionName);
  const eligible = (lap: NonNullable<typeof leftDriver>["laps"][number]) =>
    lap.lapDuration !== null &&
    lap.lapDuration > 0 &&
    !lap.isPitLap &&
    !lap.isPitOutLap;
  const selectedLap = (driver: typeof leftDriver, side: string, excludedId: number | null = null) => {
    if (!driver) return null;
    const stint =
      race &&
      driver.stints.find(
        (item) => item.stintNumber === Number(searchParams.get(side + "Stint")),
      );
    const laps = driver.laps.filter(
      (lap) => eligible(lap) && lap.id !== excludedId && (!stint || lap.stint === stint.stintNumber),
    );
    return (
      laps.find(
        (lap) => lap.lapNumber === Number(searchParams.get(side + "Lap")),
      )?.id ?? getPreferredLapId({ ...driver, laps }, null)
    );
  };
  const leftLapId = selectedLap(leftDriver, "left");
  const rightLapId = selectedLap(rightDriver, "right", leftLapId);
  useEffect(() => {
    const step = Number(searchParams.get("step") ?? 10);
    const smoothing = Number(searchParams.get("smooth") ?? 3);
    setDistanceStep(
      Number.isInteger(step) && step >= 5 && step <= 100 ? step : 10,
    );
    setSmoothingWindow(
      Number.isInteger(smoothing) &&
        smoothing >= 1 &&
        smoothing <= 21 &&
        smoothing % 2 === 1
        ? smoothing
        : 3,
    );
    setLinkMessage("");
  }, [searchParams]);
  useEffect(() => {
    invalidate();
    setDriversExpanded(!(leftDriverId && rightDriverId));
  }, [
    sessionId,
    leftDriverId,
    rightDriverId,
    leftLapId,
    rightLapId,
    distanceStep,
    smoothingWindow,
  ]);

  function updateSelection(values: Record<string, number | null>) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) next.delete(key);
        else next.set(key, String(value));
      }
      return next;
    });
  }
  function chooseLap(side: "left" | "right", lapId: number) {
    const driver = side === "left" ? leftDriver : rightDriver;
    const lap = driver?.laps.find((item) => item.id === lapId);
    if (lap) {
      invalidate();
      updateSelection({ [side + "Lap"]: lap.lapNumber });
    }
  }
  async function copySelection() {
    const query = new URLSearchParams(searchParams);
    if (leftDriver && rightDriver) {
      query.set("left", String(leftDriver.driverNumber));
      query.set("right", String(rightDriver.driverNumber));
      for (const [side, driver, lapId] of [
        ["left", leftDriver, leftLapId],
        ["right", rightDriver, rightLapId],
      ] as const) {
        const lap = driver.laps.find((lap) => lap.id === lapId);
        if (lap) query.set(side + "Lap", String(lap.lapNumber));
      }
    }
    if (validSettings) {
      query.set("step", String(distanceStep));
      query.set("smooth", String(smoothingWindow));
    }
    const url = new URL(window.location.href);
    url.search = query.toString();
    try {
      await navigator.clipboard.writeText(url.href);
      setLinkMessage("Link copied");
    } catch {
      setLinkMessage(
        "Copy the address from your browser to share this selection.",
      );
    }
  }

  function invalidate() {
    request.current?.abort();
    requestVersion.current++;
    setComparison(null);
    setComparing(false);
    setError(null);
  }
  function selectDriver(side: "left" | "right", driverId: number) {
    invalidate();
    const lapId = overview
      ? getPreferredLapId(getDriverById(overview, driverId), null)
      : null;
    const driver = overview ? getDriverById(overview, driverId) : null;
    if (driver)
      updateSelection({
        [side]: driver.driverNumber,
        [side + "Lap"]:
          driver.laps.find((lap) => lap.id === lapId)?.lapNumber ?? null,
        [side + "Stint"]: null,
      });
  }
  async function handleCompare() {
    if (!overview || !leftLapId || !rightLapId) return;
    invalidate();
    const version = requestVersion.current;
    const controller = new AbortController();
    request.current = controller;
    setComparing(true);
    setProgress("Waiting for analysis…");
    try {
      const payload = await compareLaps(
        {
          sessionId: overview.id,
          referenceLapId: leftLapId,
          targetLapId: rightLapId,
          distanceStep,
          smoothingWindow,
        },
        controller.signal,
        (message) => {
          if (!controller.signal.aborted && version === requestVersion.current)
            setProgress(message);
        },
      );
      if (!controller.signal.aborted && version === requestVersion.current)
        setComparison(payload);
    } catch (error) {
      if (!controller.signal.aborted && version === requestVersion.current)
        setError(getErrorMessage(error));
    } finally {
      if (version === requestVersion.current) setComparing(false);
    }
  }
  const pairReady = !!leftDriver && !!rightDriver;
  const validSettings =
    Number.isInteger(distanceStep) &&
    distanceStep >= 5 &&
    distanceStep <= 100 &&
    Number.isInteger(smoothingWindow) &&
    smoothingWindow >= 1 &&
    smoothingWindow <= 21 &&
    smoothingWindow % 2 === 1;

  return (
    <div className="shell shell--full">
      <main className="dashboard">
        <header className="page-header">
          <div>
            <Link to="/" className="back-link">
              ← Sessions
            </Link>
            <h1>
              {overview
                ? overview.countryName + " · " + overview.sessionName
                : "Session analysis"}
            </h1>
            <p className="muted">
              {overview
                ? overview.year + " / " + overview.circuitShortName
                : "Choose drivers to begin."}
            </p>
          </div>
          <span className="app-mark">F1 / TELEMETRY</span>
        </header>
        {error && !pairReady && (
          <div role="alert" className="error-banner">
            {error}
          </div>
        )}
        {loading && (
          <p role="status" className="empty-state">
            Loading session…
          </p>
        )}
        {overview && (
          <>
            <section
              className="driver-selection-stage"
              aria-labelledby="driver-stage-title"
            >
              <div className="stage-heading">
                <div>
                  <h2 id="driver-stage-title">
                    {pairReady ? "Driver comparison" : "Choose your drivers"}
                  </h2>
                  <p className="muted">
                    {race
                      ? "Select a reference and a comparison driver. You can compare two laps from the same driver."
                      : "Select drivers, then choose their qualifying laps."}
                  </p>
                </div>
                {pairReady && (
                  <button
                    type="button"
                    className="button-secondary"
                    aria-expanded={driversExpanded}
                    aria-controls="driver-lists"
                    onClick={() => setDriversExpanded((value) => !value)}
                  >
                    {driversExpanded ? "Confirm drivers" : "Change drivers"}
                  </button>
                )}
              </div>
              {!driversExpanded && leftDriver && rightDriver && (
                <div className="selected-driver-pair">
                  <div>
                    <i className="trace-dot trace-dot--reference" />
                    <strong>{leftDriver.fullName}</strong>
                    <span>
                      Left · {leftDriver.result.classificationLabel} ·{" "}
                      {leftDriver.teamName}
                    </span>
                  </div>
                  <span className="pair-vs">VS</span>
                  <div>
                    <i className="trace-dot trace-dot--target" />
                    <strong>{rightDriver.fullName}</strong>
                    <span>
                      Right · {rightDriver.result.classificationLabel} ·{" "}
                      {rightDriver.teamName}
                    </span>
                  </div>
                </div>
              )}
              {driversExpanded && (
                <div className="selection-grid" id="driver-lists">
                  <DriverPicker
                    side="left"
                    drivers={overview.driverSummaries}
                    selectedId={leftDriverId}
                    onSelect={(id) => selectDriver("left", id)}
                    race={race}
                  />
                  <DriverPicker
                    side="right"
                    drivers={overview.driverSummaries}
                    selectedId={rightDriverId}
                    onSelect={(id) => selectDriver("right", id)}
                    race={race}
                  />
                </div>
              )}
              {!pairReady && (
                <p className="selection-hint" role="status">
                  {leftDriver
                    ? leftDriver.acronym +
                      " selected on the left. Now choose the right driver."
                    : rightDriver
                      ? rightDriver.acronym +
                        " selected on the right. Now choose the left driver."
                      : "Choose one card on each side to start the analysis."}
                </p>
              )}
            </section>
          </>
        )}
        {pairReady && leftDriver && rightDriver && (
          <>
            {race && (
              <section
                className="race-pace-stage"
                id="race-pace"
                aria-labelledby="race-pace-title"
              >
                <div className="stage-heading">
                  <div>
                    <h2 id="race-pace-title">Race pace & stints</h2>
                  </div>
                  <a href="#lap-comparison" className="back-link">
                    Compare individual laps ↓
                  </a>
                </div>
                <StintPerformancePanel
                  key={leftDriver.id + ":" + rightDriver.id}
                  leftDriver={leftDriver}
                  rightDriver={rightDriver}
                />
              </section>
            )}
            <section
              className="panel lap-selection-stage"
              id="lap-comparison"
              aria-labelledby="lap-stage-title"
            >
              <div className="stage-heading">
                <div>
                  <h2 id="lap-stage-title">Choose laps to compare</h2>
                  <p className="muted">
                    Fastest eligible laps are preselected. For the same driver,
                    two different laps are selected automatically.
                  </p>
                </div>
                <div className="share-selection">
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => void copySelection()}
                  >
                    Copy selection link
                  </button>
                  <span role="status" className="muted">
                    {linkMessage}
                  </span>
                </div>
              </div>
              <div className="lap-selection-grid">
                {(["left", "right"] as const).map((side) => {
                  const driver = side === "left" ? leftDriver : rightDriver;
                  const stintFilter =
                    race &&
                    driver.stints.some(
                      (stint) =>
                        stint.stintNumber ===
                        Number(searchParams.get(side + "Stint")),
                    )
                      ? Number(searchParams.get(side + "Stint"))
                      : null;
                  const laps = driver.laps.filter(
                    (lap) =>
                      (side !== "right" || lap.id !== leftLapId) &&
                      lap.lapDuration !== null &&
                      lap.lapDuration > 0 &&
                      !lap.isPitLap &&
                      !lap.isPitOutLap &&
                      (stintFilter === null || lap.stint === stintFilter),
                  );
                  return (
                    <div
                      key={side}
                      className={
                        "lap-selection-column lap-selection-column--" + side
                      }
                    >
                      {race && (
                        <label htmlFor={side + "-stint"}>
                          {driver.acronym} · Stint filter
                          <select
                            id={side + "-stint"}
                            value={stintFilter ?? ""}
                            onChange={(event) => {
                              const stint = event.target.value
                                ? Number(event.target.value)
                                : null;
                              const current = driver.laps.find(
                                (lap) =>
                                  lap.id ===
                                  (side === "left" ? leftLapId : rightLapId),
                              );
                              const candidates = driver.laps.filter(
                                (lap) =>
                                  eligible(lap) &&
                                  (stint === null || lap.stint === stint),
                              );
                              const nextLap =
                                current && candidates.includes(current)
                                  ? current
                                  : [...candidates].sort(
                                      (a, b) => a.lapDuration! - b.lapDuration!,
                                    )[0];
                              invalidate();
                              updateSelection({
                                [side + "Stint"]: stint,
                                [side + "Lap"]: nextLap?.lapNumber ?? null,
                              });
                            }}
                          >
                            <option value="">All stints</option>
                            {driver.stints.map((stint) => (
                              <option key={stint.id} value={stint.stintNumber}>
                                {"Stint " +
                                  stint.stintNumber +
                                  " · " +
                                  (stint.compound ?? "Unknown") +
                                  " · L" +
                                  stint.lapStart +
                                  "–" +
                                  stint.lapEnd}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label htmlFor={side + "-lap"}>
                        <span>
                          <i
                            className={
                              "trace-dot trace-dot--" +
                              (side === "left" ? "reference" : "target")
                            }
                          />
                          {driver.acronym} ·{" "}
                          {side === "left" ? "Left lap" : "Right lap"}
                        </span>
                      </label>
                      <select
                        id={side + "-lap"}
                        value={(side === "left" ? leftLapId : rightLapId) ?? ""}
                        disabled={!laps.length}
                        onChange={(event) => {
                          invalidate();
                          chooseLap(side, Number(event.target.value));
                        }}
                      >
                        <option value="" disabled>
                          {side === "right" && leftDriverId === rightDriverId
                            ? "No other eligible lap in this stint"
                            : "No eligible timed laps"}
                        </option>
                        {laps.map((lap) => (
                          <option key={lap.id} value={lap.id}>
                            {"L" +
                              lap.lapNumber +
                              " · " +
                              formatLapTime(lap.lapDuration) +
                              (lap.tyreCompound
                                ? " · " + lap.tyreCompound
                                : "") +
                              (lap.tyreAge != null
                                ? " / " +
                                  lap.tyreAge +
                                  (lap.tyreAge === 1 ? " lap" : " laps")
                                : "")}
                          </option>
                        ))}
                      </select>
                      {!laps.length && (
                        <p className="muted">
                          {side === "right" && leftDriverId === rightDriverId
                            ? "No different lap is available in this stint. Choose another stint or driver."
                            : "No eligible laps in this selection. Try another stint or driver."}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="selection-footer">
                <details className="settings">
                  <summary>Analysis settings</summary>
                  <div className="settings-fields">
                    <label>
                      Distance step · m
                      <input
                        type="number"
                        min={5}
                        max={100}
                        step={5}
                        value={distanceStep}
                        onBlur={() => {
                          if (validSettings)
                            updateSelection({
                              step: distanceStep,
                              smooth: smoothingWindow,
                            });
                        }}
                        onChange={(event) => {
                          invalidate();
                          setDistanceStep(Number(event.target.value));
                        }}
                      />
                    </label>
                    <label>
                      Smoothing · samples
                      <input
                        type="number"
                        min={1}
                        max={21}
                        step={2}
                        value={smoothingWindow}
                        onBlur={() => {
                          if (validSettings)
                            updateSelection({
                              step: distanceStep,
                              smooth: smoothingWindow,
                            });
                        }}
                        onChange={(event) => {
                          invalidate();
                          setSmoothingWindow(Number(event.target.value));
                        }}
                      />
                    </label>
                    <p className="muted">
                      Smoothing affects speed and throttle. Use an odd window,
                      or 1 for the original signal.
                    </p>
                  </div>
                </details>
                <button
                  onClick={() => void handleCompare()}
                  disabled={
                    comparing ||
                    !leftLapId ||
                    !rightLapId ||
                    leftLapId === rightLapId ||
                    !validSettings
                  }
                >
                  {comparing ? progress : "Compare laps"}
                </button>
              </div>
              {leftLapId && leftLapId === rightLapId && (
                <p className="muted">
                  Choose two different laps. You can compare the same driver on
                  both sides.
                </p>
              )}
              {error && (
                <div role="alert" className="error-banner">
                  {error}
                </div>
              )}
            </section>
          </>
        )}
        {comparing && (
          <p role="status" className="loading-note">
            {progress} The first comparison can take longer while telemetry is
            downloaded.
          </p>
        )}
        {comparison &&
          comparison.settings.deltaConvention !== "reference-minus-target" && (
            <p role="status" className="loading-note">
              Analysis updated. Compare the selected laps again to refresh the
              result.
            </p>
          )}
        {pairReady &&
          comparison &&
          comparison.settings.deltaConvention === "reference-minus-target" &&
          comparison.miniSectors && (
            <ComparisonView
              key={comparison.referenceLap.id + ":" + comparison.targetLap.id}
              comparison={comparison}
            />
          )}
      </main>
    </div>
  );
}

function ComparisonView({ comparison }: { comparison: ComparisonResponse }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tab, setTab] = useState("telemetry");
  const [showMap, setShowMap] = useState(true);
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const selectedMiniSector = comparison.miniSectors.find(
    (sector) => sector.number === selectedSector,
  );
  const [showPedals, setShowPedals] = useState(true);
  const [showGear, setShowGear] = useState(true);
  const reference = comparison.referenceLap,
    target = comparison.targetLap;
  const maxDistance = reference.points.at(-1)?.distanceM ?? 1;
  const chartSeries = useMemo(() => {
    const traces = (key: "speedKph" | "throttlePct" | "brakePct") => [
      {
        label: reference.driver.acronym + " L" + reference.lapNumber,
        color: "#cf2f27",
        points: reference.points.map((p) => ({
          distanceM: p.distanceM,
          value: p[key],
        })),
      },
      {
        label: target.driver.acronym + " L" + target.lapNumber,
        color: "#1d658a",
        points: target.points.map((p) => ({
          distanceM: p.distanceM,
          value: p[key],
        })),
      },
    ];
    return {
      speed: traces("speedKph"),
      throttle: traces("throttlePct"),
      brake: traces("brakePct"),
      gear: [reference, target].map((lap, index) => ({
        label: lap.driver.acronym + " L" + lap.lapNumber,
        color: index ? "#1d658a" : "#cf2f27",
        points: lap.points
          .filter((point) => point.gear !== null)
          .map((point) => ({ distanceM: point.distanceM, value: point.gear! })),
      })),
      delta: [
        {
          label:
            reference.driver.acronym +
            " L" +
            reference.lapNumber +
            " − " +
            target.driver.acronym +
            " L" +
            target.lapNumber,
          color: "#cf2f27",
          points: comparison.delta.points.map((p) => ({
            distanceM: p.distanceM,
            value: p.deltaMs,
          })),
        },
      ],
    };
  }, [comparison, reference, target]);
  const guides = useMemo(() => {
    let elapsed = 0;
    const markers: Array<{ distanceM: number; label: string }> = [];
    for (const [index, duration] of [
      reference.sectors.sector1Ms,
      reference.sectors.sector2Ms,
    ].entries()) {
      if (duration === null || duration <= 0) break;
      elapsed += duration;
      const rightIndex = reference.points.findIndex(
        (point) => point.timeOffsetMs >= elapsed,
      );
      if (rightIndex < 1) continue;
      const left = reference.points[rightIndex - 1],
        right = reference.points[rightIndex];
      markers.push({
        label: "S" + (index + 1),
        distanceM:
          left.distanceM +
          ((right.distanceM - left.distanceM) * (elapsed - left.timeOffsetMs)) /
            Math.max(1, right.timeOffsetMs - left.timeOffsetMs),
      });
    }
    return markers;
  }, [reference]);
  const shared = {
    maxDistance,
    hoverDistance: hover,
    onHover: setHover,
    guides,
    highlightedRange: selectedMiniSector
      ? {
          start: selectedMiniSector.startDistanceM,
          end: selectedMiniSector.endDistanceM,
        }
      : undefined,
  };
  return (
    <>
      <section className="result-strip">
        <div>
          <span className="trace-dot trace-dot--reference" />
          {reference.driver.acronym} · L{reference.lapNumber}
          <strong>{formatLapTime(reference.lapDuration)}</strong>
        </div>
        <div>
          <span className="trace-dot trace-dot--target" />
          {target.driver.acronym} · L{target.lapNumber}
          <strong>{formatLapTime(target.lapDuration)}</strong>
        </div>
        <div>
          Δ {reference.driver.acronym} L{reference.lapNumber} −{" "}
          {target.driver.acronym} L{target.lapNumber}
          <strong>
            {formatDelta(comparison.delta.summary.officialDeltaMs)}
          </strong>
          <p className="delta-explainer">
            {Math.abs(comparison.delta.summary.officialDeltaMs) < 0.5
              ? "Same official lap time"
              : reference.driver.acronym +
                (comparison.delta.summary.officialDeltaMs > 0
                  ? " is slower by "
                  : " is faster by ") +
                (
                  Math.abs(comparison.delta.summary.officialDeltaMs) / 1000
                ).toFixed(3) +
                " s"}
          </p>
        </div>
      </section>
      <nav className="view-tabs" aria-label="Comparison views">
        {[
          ["telemetry", "Telemetry"],
          ["zones", "Braking zones"],
          ["report", "Report"],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "telemetry" && (
        <>
          {showMap && (
            <div className="comparison-map">
              <TrackMap comparison={comparison} hoverDistance={hover} onHover={setHover} />
            </div>
          )}
          <MiniSectorPanel
            comparison={comparison}
            selected={selectedSector}
            onSelect={(number) => {
              setSelectedSector(number);
              const sector = comparison.miniSectors.find(
                (item) => item.number === number,
              );
              setHover(
                sector
                  ? (sector.startDistanceM + sector.endDistanceM) / 2
                  : null,
              );
            }}
          />
          <div className="chart-toolbar">
            <div className="chart-visibility" role="group" aria-label="Visible charts">
              <span className="chart-visibility__label">Show</span>
              {[
                { label: "Pedals", enabled: showPedals, toggle: () => setShowPedals(!showPedals) },
                { label: "Gear", enabled: showGear, toggle: () => setShowGear(!showGear) },
                { label: "Track map", enabled: showMap, toggle: () => setShowMap(!showMap) },
              ].map(({ label, enabled, toggle }) => (
                <button type="button" className="chart-toggle" key={label}
                  aria-pressed={enabled} onClick={toggle}>
                  <span className="chart-toggle__indicator" aria-hidden="true">{enabled ? "✓" : "+"}</span>
                  {label}
                </button>
              ))}
            </div>
            <label className="distance-control">
              {hover === null ? "Inspect distance" : Math.round(hover) + " m"}
              <input
                aria-label="Inspect distance along the lap"
                type="range"
                min={0}
                max={maxDistance}
                step={comparison.settings.distanceStep}
                value={hover ?? 0}
                onChange={(e) => setHover(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="chart-grid">
            <ChartCard
              {...shared}
              title="Speed"
              subtitle="Both laps on the same estimated distance axis."
              unit="km/h"
              series={chartSeries.speed}
            />
            <ChartCard
              {...shared}
              title="Cumulative time difference"
              subtitle="Left minus right · + left loses time · − left gains time."
              unit="ms"
              centerZero
              series={chartSeries.delta}
            />
            {showPedals && (
              <>
                <ChartCard
                  {...shared}
                  title="Throttle"
                  subtitle="Throttle application along the lap."
                  unit="%"
                  series={chartSeries.throttle}
                />
                <ChartCard
                  {...shared}
                  title="Brake pedal"
                  subtitle="Pressed or released; this is not brake pressure."
                  unit="%"
                  discrete
                  series={chartSeries.brake}
                />
              </>
            )}
            {showGear && (
              <ChartCard
                {...shared}
                title="Gear"
                subtitle="Selected gear · held between samples; unavailable samples omitted."
                unit="gear"
                discrete
                series={chartSeries.gear}
              />
            )}
          </div>
        </>
      )}
      {tab === "zones" && <CornerAnalysisPanel comparison={comparison} />}
      {tab === "report" && <EngineerReportPanel comparison={comparison} />}
      <details className="quality-note">
        <summary>Data quality & calculation method</summary>
        <p>
          {comparison.quality.sectorAlignment.mode === "sector-anchored"
            ? "Start, sector boundaries and finish are anchored to official timing. Agreement at these points is enforced by the calculation."
            : "Only start and finish are anchored to official lap times."}{" "}
          Between these points, differences remain telemetry estimates.
        </p>
        {comparison.quality.warnings.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <p>
          Source samples: {comparison.quality.reference?.sourceSamples ?? "—"} /{" "}
          {comparison.quality.target?.sourceSamples ?? "—"}. Largest gap:{" "}
          {comparison.quality.reference?.maxGapMs ?? "—"} /{" "}
          {comparison.quality.target?.maxGapMs ?? "—"} ms.
        </p>
      </details>
    </>
  );
}
