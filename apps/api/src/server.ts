import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { HttpError } from "./lib/errors.js";

import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { analysisRoutes } from "./routes/analysisRoutes.js";
import { openf1Routes } from "./routes/openf1Routes.js";
import { sessionRoutes } from "./routes/sessionRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, "../../web/dist");

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_request, response, next) => {
  try {
    const sessionsCount = await prisma.session.count();
    const lapsCount = await prisma.lap.count();

    response.json({
      status: "ok",
      database: "connected",
      sessionsCount,
      lapsCount,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/openf1", openf1Routes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/analysis", analysisRoutes);

app.use(express.static(webDistPath));

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) {
    response.status(404).json({ error: "API route not found." });
    return;
  }

  response.sendFile(path.join(webDistPath, "index.html"), (error) => {
    if (error) {
      next(error);
    }
  });
});

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      response
        .status(400)
        .json({
          error: error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        });
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({ error: "Request body must be valid JSON." });
      return;
    }
    console.error(error);
    const databaseError =
      error instanceof Prisma.PrismaClientKnownRequestError ||
      error instanceof Prisma.PrismaClientInitializationError;
    response
      .status(databaseError ? 503 : 500)
      .json({
        error: databaseError
          ? "Database unavailable or not initialized. Check DATABASE_URL and run npm run db:push."
          : "Unable to complete the request. Please try again.",
      });
  },
);

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});
