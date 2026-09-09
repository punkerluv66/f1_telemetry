// Standalone production-mode profiling page; never included in the application.
import { build } from "esbuild";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
const entry = fileURLToPath(new URL("./profiling/ui.tsx", import.meta.url));
const bundle = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  outdir: "profile-bundle",
});
const assets = new Map(
  bundle.outputFiles.map((file) => [
    file.path.endsWith(".css") ? "/ui.css" : "/ui.js",
    file.contents,
  ]),
);
createServer((request, response) => {
  const asset = assets.get(request.url);
  response.setHeader("Cache-Control", "no-store");
  if (asset) {
    response.setHeader(
      "Content-Type",
      request.url.endsWith(".css") ? "text/css" : "text/javascript",
    );
    response.end(asset);
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Telemetry profiling</title><link rel="stylesheet" href="/ui.css"><div id="root"></div><script type="module" src="/ui.js"></script>',
  );
}).listen(4174, "127.0.0.1", () =>
  console.log("Production profiling page: http://127.0.0.1:4174"),
);
