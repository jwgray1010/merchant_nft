import { Router } from "express";
import { tenantSettingsUpsertSchema } from "../schemas/tenantSchema";
import {
  getOwnerTenantSettings,
  upsertOwnerTenantSettings,
} from "../services/tenantStore";

const router = Router();

router.get("/settings", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const tenant = await getOwnerTenantSettings(userId);
    return res.json(
      tenant ?? {
        appName: "MainStreetAI",
        hideMainstreetaiBranding: false,
      },
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/settings", async (req, res, next) => {
  const parsed = tenantSettingsUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid tenant settings payload",
      details: parsed.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const tenant = await upsertOwnerTenantSettings(userId, parsed.data);
    return res.json(tenant);
  } catch (error) {
    return next(error);
  }
});

export default router;
