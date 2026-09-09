import { Router } from "express";
import { z } from "zod";

import { compareLaps } from "../services/analysisService.js";
import { HttpError } from "../lib/errors.js";

const compareSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
  referenceLapId: z.coerce.number().int().positive(),
  targetLapId: z.coerce.number().int().positive(),
  distanceStep: z.coerce.number().int().min(5).max(100).default(10),
  smoothingWindow: z.coerce
    .number()
    .int()
    .min(1)
    .max(21)
    .refine((value) => value % 2 === 1, "Use an odd smoothing window.")
    .default(3),
});

export const analysisRoutes = Router();

analysisRoutes.post("/compare", async (request, response, next) => {
  try {
    const body = compareSchema.parse(request.body);
    if (request.get("accept") === "application/x-ndjson") {
      response.setHeader("Content-Type", "application/x-ndjson");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      const send = (event: unknown) => {
        if (!response.destroyed && !response.writableEnded)
          response.write(JSON.stringify(event) + "\n");
      };
      try {
        const result = await compareLaps(body, (stage) =>
          send({ type: "progress", stage }),
        );
        send({ type: "result", result });
      } catch (error) {
        if (!(error instanceof HttpError)) console.error(error);
        send({
          type: "error",
          error:
            error instanceof HttpError
              ? error.message
              : "Unable to complete the comparison. Check the API and database, then retry.",
        });
      } finally {
        response.end();
      }
      return;
    }
    const result = await compareLaps(body);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
