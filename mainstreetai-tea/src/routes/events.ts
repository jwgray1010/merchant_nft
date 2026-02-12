import { Router } from "express";
import { runPrompt } from "../ai/runPrompt";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { eventsOutputSchema, eventsRequestSchema } from "../schemas/eventsRequestSchema";
import { getAdapter } from "../storage/getAdapter";
import { getLocationById } from "../services/locationStore";

const router = Router();

router.post("/", async (req, res, next) => {
  const parsed = eventsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten(),
    });
  }

  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /events?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrandId.data, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId.trim() !== ""
        ? req.query.locationId.trim()
        : null;
    const location = locationId
      ? await getLocationById(userId, parsedBrandId.data, locationId)
      : null;
    if (locationId && !location) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }

    const result = await runPrompt({
      promptFile: "events.md",
      brandProfile: brand,
      userId,
      locationContext: location
        ? {
            id: location.id,
            name: location.name,
            address: location.address,
            timezone: location.timezone,
          }
        : undefined,
      input: {
        ...parsed.data,
        ...(location
          ? {
              location: {
                id: location.id,
                name: location.name,
                address: location.address,
                timezone: location.timezone,
              },
            }
          : {}),
      },
      outputSchema: eventsOutputSchema,
    });

    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
