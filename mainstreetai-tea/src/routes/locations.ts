import { Router } from "express";
import { requirePlan } from "../billing/requirePlan";
import { brandIdSchema } from "../schemas/brandSchema";
import { locationCreateSchema, locationUpdateSchema } from "../schemas/locationSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  addLocation,
  deleteLocation,
  getLocationById,
  listLocations,
  updateLocation,
} from "../services/locationStore";

const router = Router();

function parseBrandId(raw: unknown): { ok: true; brandId: string } | { ok: false; status: number; body: unknown } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          "Missing brandId query parameter. Example: /api/locations?brandId=main-street-nutrition",
      },
    };
  }
  const parsed = brandIdSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "Invalid brandId query parameter",
        details: parsed.error.flatten(),
      },
    };
  }
  return { ok: true, brandId: parsed.data };
}

function isElevatedRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

router.get("/", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }

    const locations = await listLocations(userId, parsedBrand.brandId);
    return res.json(locations);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const parsedBody = locationCreateSchema.safeParse({
    name: req.body?.name,
    address: optionalString(req.body?.address),
    timezone: optionalString(req.body?.timezone),
    googleLocationName: optionalString(req.body?.googleLocationName),
    bufferProfileId: optionalString(req.body?.bufferProfileId),
  });
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid location payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Only owner/admin can manage locations" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }

    const location = await addLocation(userId, parsedBrand.brandId, parsedBody.data);
    return res.status(201).json(location);
  } catch (error) {
    return next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const locationId = req.params.id?.trim();
  if (!locationId) {
    return res.status(400).json({ error: "Missing location id route parameter" });
  }
  const rawUpdates: Record<string, unknown> = {};
  if (typeof req.body?.name === "string" && req.body.name.trim() !== "") {
    rawUpdates.name = req.body.name.trim();
  }
  const address = optionalString(req.body?.address);
  if (address !== undefined) {
    rawUpdates.address = address;
  }
  const timezone = optionalString(req.body?.timezone);
  if (timezone !== undefined) {
    rawUpdates.timezone = timezone;
  }
  const googleLocationName = optionalString(req.body?.googleLocationName);
  if (googleLocationName !== undefined) {
    rawUpdates.googleLocationName = googleLocationName;
  }
  const bufferProfileId = optionalString(req.body?.bufferProfileId);
  if (bufferProfileId !== undefined) {
    rawUpdates.bufferProfileId = bufferProfileId;
  }
  const parsedBody = locationUpdateSchema.safeParse(rawUpdates);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid location update payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Only owner/admin can manage locations" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const planCheck = await requirePlan(userId, parsedBrand.brandId, "starter");
    if (!planCheck.ok) {
      return res.status(planCheck.status).json(planCheck.body);
    }
    const updated = await updateLocation(userId, parsedBrand.brandId, locationId, parsedBody.data);
    if (!updated) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const locationId = req.params.id?.trim();
  if (!locationId) {
    return res.status(400).json({ error: "Missing location id route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const role = req.brandAccess?.role ?? req.user?.brandRole ?? "owner";
    if (!isElevatedRole(role)) {
      return res.status(403).json({ error: "Only owner/admin can manage locations" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const deleted = await deleteLocation(userId, parsedBrand.brandId, locationId);
    if (!deleted) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.status).json(parsedBrand.body);
  }
  const locationId = req.params.id?.trim();
  if (!locationId) {
    return res.status(400).json({ error: "Missing location id route parameter" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brand = await getAdapter().getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }
    const location = await getLocationById(userId, parsedBrand.brandId, locationId);
    if (!location) {
      return res.status(404).json({ error: `Location '${locationId}' was not found` });
    }
    return res.json(location);
  } catch (error) {
    return next(error);
  }
});

export default router;
