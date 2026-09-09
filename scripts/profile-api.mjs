// Reproducible measurements and numerical residuals, not an automated test suite.
// Does not delete telemetry or caches. Uses existing cached laps for HTTP runs.
import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const output = path.join(root, "docs/profiling");
const scratch = path.join(root, ".profiling");
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
const sourcePath = path.join(root, "apps/api/src/services/analysisService.ts");
const source = await readFile(sourcePath, "utf8");
await build({
  stdin: {
    contents:
      source +
      "\nexport {buildTelemetryPoints, normalizeTelemetry, alignTelemetry, buildMiniSectors, smoothComparablePoints};",
    resolveDir: path.dirname(sourcePath),
    loader: "ts",
  },
  outfile: path.join(scratch, "analysis.mjs"),
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  define: { "import.meta.url": JSON.stringify(pathToFileURL(sourcePath).href) },
});
const algorithms = await import(
  pathToFileURL(path.join(scratch, "analysis.mjs")).href + "?run=" + Date.now()
);
const summary = (values) => {
  const a = [...values].sort((x, y) => x - y);
  return {
    n: a.length,
    medianMs: +a[Math.ceil(a.length * 0.5) - 1].toFixed(3),
    p95Ms: +a[Math.ceil(a.length * 0.95) - 1].toFixed(3),
    maxMs: +a.at(-1).toFixed(3),
  };
};
const maxAbs = (values) =>
  values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
const round = (value) => +value.toFixed(6);
const start = Date.UTC(2025, 0, 1);
function synthetic(duration, cadence, accelerating = false) {
  const carData = [];
  for (let ms = -300; ms <= duration * 1000 + 500; ms += cadence) {
    const t = ms / 1000,
      scale = duration / 100;
    const speed = accelerating
      ? (40 + (0.2 * t) / scale) / scale
      : 5000 / duration;
    carData.push({
      date: new Date(start + ms).toISOString(),
      speed: speed * 3.6,
      throttle: 70,
      brake: ms >= 30000 && ms < 35000 ? 100 : 0,
      n_gear: ms < 50000 ? 5 : 6,
      rpm: 11000,
      drs: 0,
    });
  }
  return algorithms.buildTelemetryPoints({
    lap: {
      id: 0,
      sessionId: 0,
      driverId: 0,
      dateStart: new Date(start),
      lapDuration: duration,
    },
    carData,
    locationData: [],
  });
}
const numerical = [];
for (const accelerating of [false, true]) {
  const rawLeft = synthetic(100, 230, accelerating),
    rawRight = synthetic(102, 370, accelerating);
  const left = algorithms.normalizeTelemetry(rawLeft.points);
  const right = algorithms.normalizeTelemetry(rawRight.points, {
    scaleToDistanceM: left.normalizedLapLengthM,
  });
  const a = algorithms.alignTelemetry({
    points: left.points,
    distanceStep: 10,
    smoothingWindow: 1,
    maxDistance: 5000,
  });
  const b = algorithms.alignTelemetry({
    points: right.points,
    distanceStep: 10,
    smoothingWindow: 1,
    maxDistance: 5000,
  });
  const analyticTime = (d) =>
    accelerating ? (-40 + Math.sqrt(1600 + 0.4 * d)) / 0.2 : d / 50;
  const deltas = a.map((p, i) => p.timeOffsetMs - b[i].timeOffsetMs);
  const minis = algorithms.buildMiniSectors(a, b, 5000);
  const smooth = algorithms.alignTelemetry({
    points: left.points,
    distanceStep: 10,
    smoothingWindow: 21,
    maxDistance: 5000,
  });
  numerical.push({
    scenario: accelerating
      ? "linear acceleration, unequal sample cadences"
      : "constant speeds, unequal sample cadences",
    expectedLapDeltaMs: -2000,
    samples: [rawLeft.points.length, rawRight.points.length],
    maxDeltaResidualMs: round(
      maxAbs(
        a.map((p, i) => deltas[i] + 0.02 * analyticTime(p.distanceM) * 1000),
      ),
    ),
    maxLeftTimeResidualMs: round(
      maxAbs(a.map((p) => p.timeOffsetMs - analyticTime(p.distanceM) * 1000)),
    ),
    distanceResidualM: round(left.rawLapLengthM - 5000),
    miniSectorSumMs: round(minis.reduce((sum, s) => sum + s.deltaMs, 0)),
    miniSectorSumResidualMs: round(
      minis.reduce((sum, s) => sum + s.deltaMs, 0) + 2000,
    ),
    smoothingTimingDifferenceMs: round(
      maxAbs(a.map((p, i) => p.timeOffsetMs - smooth[i].timeOffsetMs)),
    ),
    smoothingBrakeChanges: a.filter((p, i) => p.brakePct !== smooth[i].brakePct)
      .length,
    smoothingGearChanges: a.filter((p, i) => p.gear !== smooth[i].gear).length,
    discreteBrakeValues: [...new Set(a.map((p) => p.brakePct))],
    discreteGearValues: [...new Set(a.map((p) => p.gear))],
  });
}
const timings = [];
for (const n of [1000, 10000, 50000]) {
  const points = Array.from({ length: n }, (_, i) => ({
    distanceM: (5000 * i) / (n - 1),
    timeOffsetMs: (100000 * i) / (n - 1),
    speedKph: 180 + Math.sin(i) * 15,
    throttlePct: 70,
    brakePct: i % 10 ? 0 : 100,
    gear: 6,
    rpm: 11000,
    x: null,
    y: null,
  }));
  const elapsed = [];
  for (let run = 0; run < 31; run++) {
    const begin = performance.now();
    const normalized = algorithms.normalizeTelemetry(points);
    const aligned = algorithms.alignTelemetry({
      points: normalized.points,
      distanceStep: 5000 / (n - 1),
      smoothingWindow: 21,
      maxDistance: 5000,
    });
    algorithms.buildMiniSectors(aligned, aligned, 5000);
    if (run) elapsed.push(performance.now() - begin);
  }
  timings.push({
    inputPoints: n,
    outputPointsApproximately: n,
    smoothingWindow: 21,
    ...summary(elapsed),
  });
}
const db = new PrismaClient();
try {
  const cached = await db.comparisonCache.findMany({
    take: 30,
    orderBy: { updatedAt: "desc" },
  });
  const usable = cached.find(
    (item) =>
      item.payload?.settings?.deltaConvention === "reference-minus-target" &&
      Array.isArray(item.payload?.miniSectors) &&
      item.referenceLapId !== item.targetLapId,
  );
  const real = [];
  for (const item of cached.filter(
    (item) =>
      item.payload?.settings?.deltaConvention === "reference-minus-target" &&
      Array.isArray(item.payload?.miniSectors),
  )) {
    const payload = item.payload,
      a = payload.referenceLap,
      b = payload.targetLap;
    const times = a.points.map(
      (p, i) => p.timeOffsetMs - b.points[i].timeOffsetMs,
    );
    const interpolateAt = (points, key, value, field) => {
      let i = 1;
      while (i < points.length - 1 && points[i][key] < value) i++;
      const left = points[i - 1],
        right = points[i];
      return (
        left[field] +
        ((right[field] - left[field]) * (value - left[key])) /
          (right[key] - left[key])
      );
    };
    const sectorChecks = [];
    let leftElapsed = 0,
      rightElapsed = 0;
    for (const key of ["sector1Ms", "sector2Ms"]) {
      if (a.sectors[key] === null || b.sectors[key] === null) break;
      leftElapsed += a.sectors[key];
      rightElapsed += b.sectors[key];
      const distance = interpolateAt(
        a.points,
        "timeOffsetMs",
        leftElapsed,
        "distanceM",
      );
      const estimated =
        leftElapsed -
        interpolateAt(b.points, "distanceM", distance, "timeOffsetMs");
      const official = leftElapsed - rightElapsed;
      sectorChecks.push({
        through: key,
        referenceBoundaryDistanceM: round(distance),
        estimatedDeltaMs: round(estimated),
        officialDeltaMs: official,
        residualMs: round(estimated - official),
      });
    }
    real.push({
      sessionId: item.sessionId,
      referenceLapId: a.id,
      targetLapId: b.id,
      lapDeltaMs: payload.delta.summary.officialDeltaMs,
      deltaFormulaResidualMs: round(
        maxAbs(times.map((d, i) => d - payload.delta.points[i].deltaMs)),
      ),
      miniSumResidualMs: round(
        payload.miniSectors.reduce((sum, s) => sum + s.deltaMs, 0) -
          payload.delta.summary.officialDeltaMs,
      ),
      pointsPerLap: a.points.length,
      sectorChecks,
    });
  }
  const base = process.env.PROFILE_URL ?? "http://localhost:4001";
  const cases = [{ name: "session library", url: "/api/sessions" }];
  if (usable) {
    cases.push(
      {
        name: "session overview",
        url: "/api/sessions/" + usable.sessionId + "/overview",
      },
      {
        name: "cached comparison",
        url: "/api/analysis/compare",
        body: {
          sessionId: usable.sessionId,
          referenceLapId: usable.referenceLapId,
          targetLapId: usable.targetLapId,
          distanceStep: usable.distanceStep,
          smoothingWindow: usable.smoothingWindow,
        },
      },
    );
  }
  const http = [];
  for (const c of cases) {
    const values = [];
    let bytes = 0;
    for (let i = 0; i < 31; i++) {
      const begin = performance.now();
      const res = await fetch(base + c.url, {
        method: c.body ? "POST" : "GET",
        headers: c.body ? { "Content-Type": "application/json" } : {},
        body: c.body ? JSON.stringify(c.body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error("HTTP " + res.status + " " + c.name);
      bytes = Buffer.byteLength(text);
      if (i) values.push(performance.now() - begin);
    }
    http.push({ scenario: c.name, responseBytes: bytes, ...summary(values) });
  }
  const result = {
    recordedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: os.platform(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      api: base,
    },
    method:
      "Production API, sequential local HTTP requests; 1 warmup + 30 measurements. Synthetic numerical residuals and pure processing exclude network/DB. No caches deleted. Micro-sector residuals on cached real data check internal consistency, not physical alignment accuracy.",
    http,
    algorithmTimings: timings,
    numerical,
    realCacheConsistency: real,
  };
  await writeFile(
    path.join(output, "api-and-accuracy.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...result,
        realCacheConsistency: {
          comparisons: real.length,
          maxDeltaFormulaResidualMs: maxAbs(
            real.map((x) => x.deltaFormulaResidualMs),
          ),
          maxMiniSumResidualMs: maxAbs(real.map((x) => x.miniSumResidualMs)),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await db.$disconnect();
}
