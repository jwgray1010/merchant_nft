import { Router } from "express";
import { resolveBrandAccess } from "../auth/brandAccess";
import { brandIdSchema } from "../schemas/brandSchema";
import {
  buildGoogleBusinessAuthorizeUrl,
  completeGoogleBusinessOauthAndSave,
  createGoogleBusinessOauthState,
} from "../integrations/gbpOauth";
import { getAdapter } from "../storage/getAdapter";
import { verifyAuth } from "../supabase/verifyAuth";

const router = Router();

function appBaseUrl(): string {
  const value = process.env.APP_BASE_URL;
  if (!value || value.trim() === "") {
    return "";
  }
  return value.replace(/\/+$/, "");
}

router.get("/start", verifyAuth, async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error:
        "Missing brandId query parameter. Example: /api/integrations/gbp/start?brandId=main-street-nutrition",
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
    const actorUserId = req.user?.actorId ?? req.user?.id;
    if (!actorUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const access = await resolveBrandAccess(actorUserId, parsedBrandId.data);
    if (!access) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }
    if (access.role !== "owner" && access.role !== "admin") {
      return res.status(403).json({ error: "Insufficient role permissions" });
    }
    const ownerUserId = access.ownerId;

    const brand = await getAdapter().getBrand(ownerUserId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const state = createGoogleBusinessOauthState(ownerUserId, parsedBrandId.data);
    const authUrl = buildGoogleBusinessAuthorizeUrl(state);
    if ((req.headers.accept ?? "").includes("application/json")) {
      return res.json({ authUrl });
    }
    return res.redirect(authUrl);
  } catch (error) {
    return next(error);
  }
});

router.get("/callback", async (req, res, next) => {
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
  if (!code || !state) {
    return res.status(400).json({ error: "Missing OAuth callback code/state" });
  }

  try {
    const result = await completeGoogleBusinessOauthAndSave({
      code,
      stateToken: state,
    });

    const redirectPath = `/admin/integrations/gbp?brandId=${encodeURIComponent(
      result.brandId,
    )}&status=connected`;
    const redirectUrl = `${appBaseUrl()}${redirectPath}`;
    if ((req.headers.accept ?? "").includes("application/json")) {
      return res.json({
        ok: true,
        provider: "google_business",
        brandId: result.brandId,
        redirectUrl,
      });
    }
    return res.redirect(redirectUrl);
  } catch (error) {
    return next(error);
  }
});

export default router;
