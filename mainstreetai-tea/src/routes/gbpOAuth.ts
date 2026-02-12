import { Router } from "express";
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
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const brand = await getAdapter().getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const state = createGoogleBusinessOauthState(userId, parsedBrandId.data);
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
