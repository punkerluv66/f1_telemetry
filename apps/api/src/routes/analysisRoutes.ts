import { Router } from "express";
import { z } from "zod";

import { compareLaps } from "../services/analysisService.js";

const compareSchema = z.object({
  sessionId: z.coerce.number(),
  referenceLapId: z.coerce.number(),
  targetLapId: z.coerce.number(),
  distanceStep: z.coerce.number().int().min(5).max(100).default(10),
  smoothingWindow: z.coerce.number().int().min(1).max(21).default(5)
});

export const analysisRoutes = Router();

analysisRoutes.post("/compare", async (request, response, next) => {
  try {
    const body = compareSchema.parse(request.body);
    const result = await compareLaps(body);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
