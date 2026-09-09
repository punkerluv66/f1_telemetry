import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });
if (!process.env.DATABASE_URL)
  throw new Error(
    "Create .env from .env.example in the repository root first.",
  );
const cli = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);
const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [cli, ...args, "--schema", "apps/api/prisma/schema.prisma"],
  { cwd: root, env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
