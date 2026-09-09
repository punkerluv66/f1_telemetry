import { Router } from "express";
import { z } from "zod";

import {
  getSessionOverview,
  importSessionMetadata,
  listImportedSessions,
} from "../services/sessionImportService.js";

const importSchema = z.object({
  sessionKey: z.coerce.number().int().positive(),
});

const paramsSchema = z.object({
  sessionId: z.coerce.number().int().positive(),
});

export const sessionRoutes = Router();

sessionRoutes.get("/", async (_request, response, next) => {
  try {
    const sessions = await listImportedSessions();
    response.json({ sessions });
  } catch (error) {
    next(error);
  }
});

sessionRoutes.post("/import", async (request, response, next) => {
  try {
    const body = importSchema.parse(request.body);
    const result = await importSessionMetadata(body.sessionKey);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

sessionRoutes.get("/:sessionId/overview", async (request, response, next) => {
  try {
    const params = paramsSchema.parse(request.params);
    const session = await getSessionOverview(params.sessionId);
    response.json(session);
  } catch (error) {
    next(error);
  }
});
