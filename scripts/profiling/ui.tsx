import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChartCard } from "../../apps/web/src/components/ChartCard";
import "../../apps/web/src/styles.css";

const frame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
const heap = () =>
  (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize ?? null;
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) =>
    +sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
    ].toFixed(2);
  return { n: sorted.length, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
};
type Series = {
  label: string;
  color: string;
  points: { distanceM: number; value: number }[];
};
function data(n: number): Series[] {
  return ["LEFT", "RIGHT"].map((label, side) => ({
    label,
    color: side ? "#1d658a" : "#cf2f27",
    points: Array.from({ length: n }, (_, i) => ({
      distanceM: (i * 5500) / (n - 1),
      value:
        180 +
        90 * Math.sin((i / (n - 1)) * 45 + side * 0.04) +
        20 * Math.cos((i / (n - 1)) * 110),
    })),
  }));
}
function App() {
  const [series, setSeries] = useState<Series[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [status, setStatus] = useState("Ready");
  const [result, setResult] = useState<object | null>(null);
  const [running, setRunning] = useState(false);
  const [commit, setCommit] = useState<{
    resolve: (ms: number) => void;
    start: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (commit) commit.resolve(performance.now() - commit.start);
  }, [commit]);
  const change = (action: () => void) =>
    new Promise<number>((resolve) => {
      const start = performance.now();
      action();
      setCommit({ resolve, start });
    });
  async function run(endurance = false) {
    setRunning(true);
    setResult(null);
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration);
    });
    observer.observe({ entryTypes: ["longtask"] });
    const results = [];
    const beforeHeap = heap();
    for (const n of [1000, 10000, 50000]) {
      setStatus(`${n.toLocaleString()} points per line · mounting`);
      await change(() => {
        setSeries(null);
        setHover(null);
      });
      await frame();
      const input = data(n); // Data generation is deliberately outside the mount timer.
      const start = performance.now();
      const mountCommitMs = await change(() => setSeries(input));
      await frame();
      await frame();
      const mountTwoFramesMs = performance.now() - start;
      const latencies: number[] = [];
      const gaps: number[] = [];
      setStatus(`${n.toLocaleString()} points per line · 180 cursor updates`);
      let previous = await frame();
      for (let i = 0; i < 180; i++) {
        const time = await frame();
        gaps.push(time - previous);
        previous = time;
        latencies.push(await change(() => setHover((i * 137) % 5500)));
      }
      results.push({
        pointsPerLine: n,
        charts: 4,
        linesPerChart: 2,
        mountCommitMs: +mountCommitMs.toFixed(2),
        mountTwoFramesMs: +mountTwoFramesMs.toFixed(2),
        cursorCommit: summary(latencies),
        frameGaps: summary(gaps),
        framesOver34ms: gaps.filter((v) => v > 34).length,
        heapBytes: heap(),
      });
    }
    setStatus(
      endurance
        ? "Endurance: 90 cycles over at least 3 minutes"
        : "Repeated mount/unmount · 20 cycles",
    );
    const cycles = [];
    for (let i = 0; i < (endurance ? 90 : 20); i++) {
      await change(() => setSeries(null));
      await frame();
      const input = data(10000);
      const ms = await change(() => setSeries(input));
      await frame();
      await frame();
      cycles.push({
        cycle: i + 1,
        mountCommitMs: +ms.toFixed(2),
        heapBytes: heap(),
        domNodes: document.querySelectorAll("*").length,
      });
      if (endurance) {
        setStatus("Endurance cycle " + (i + 1) + " / 90");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    await change(() => setSeries(null));
    await frame();
    await frame();
    observer.disconnect();
    setResult({
      recordedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      productionReact: true,
      synthetic: true,
      note: "Controlled shared-cursor state updates, not end-to-end pointer latency or INP. Two animation frames approximate a rendering opportunity, not a paint timestamp. Heap is browser-reported and GC-dependent; this is not proof of leak freedom.",
      beforeHeap,
      afterHeap: heap(),
      longTasksMs: longTasks.map((v) => +v.toFixed(2)),
      results,
      cycles,
    });
    setCommit(null);
    setStatus("Complete");
    setRunning(false);
  }
  return (
    <main className="shell dashboard">
      <h1>Telemetry rendering profile</h1>
      <p>
        Synthetic workload using the application’s ChartCard in a production
        React bundle. Four charts, two lines each. Keep this tab visible
        throughout the recording.
      </p>
      <button disabled={running} onClick={() => void run()}>
        Run profile
      </button>
      <button disabled={running} onClick={() => void run(true)}>
        Run 3-minute endurance profile
      </button>
      <p role="status">{status}</p>
      {result && (
        <pre id="profile-result" style={{ whiteSpace: "pre-wrap" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      <div className="chart-grid">
        {series &&
          [0, 1, 2, 3].map((i) => (
            <ChartCard
              key={i}
              title={"Profile chart " + (i + 1)}
              subtitle="Synthetic telemetry"
              unit="km/h"
              series={series}
              maxDistance={5500}
              hoverDistance={hover}
              onHover={setHover}
            />
          ))}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
