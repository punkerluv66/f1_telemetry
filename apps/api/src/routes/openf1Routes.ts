import { Router } from "express";
import { z } from "zod";

import { searchOpenF1Sessions } from "../lib/openf1.js";

const querySchema = z.object({
  year: z.coerce.number().optional(),
  sessionName: z.string().optional()
});

export const openf1Routes = Router();

openf1Routes.get("/sessions", async (request, response, next) => {
  try {
    const query = querySchema.parse(request.query);
    const sessions = await searchOpenF1Sessions({
      year: query.year,
      sessionName: query.sessionName ?? "Qualifying"
    });

    response.json({
      sessions
    });
  } catch (error) {
    next(error);
  }
});
