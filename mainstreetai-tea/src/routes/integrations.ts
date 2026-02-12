import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { bufferConnectSchema } from "../schemas/bufferSchema";
import { getAdapter } from "../storage/getAdapter";
import {
  completeGoogleBusinessOauth,
  connectBufferIntegration,
  createGoogleBusinessConnectUrl,
} from "../integrations/providerFactory";

const router = Router();

function parseBrandId(raw: unknown) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return {
      ok: false as const,
      response: {
        status: 400,
        body: {
          error: "Missing brandId query parameter",
        },
      },
    };
  }

  const parsed = brandIdSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: {
        status: 400,
        body: {
          error: "Invalid brandId query parameter",
          details: parsed.error.flatten(),
        },
      },
    };
  }

  return { ok: true as const, brandId: parsed.data };
}

router.get("/", async (req, res, next) => {
  const parsed = parseBrandId(req.query.brandId);
  if (!parsed.ok) {
    return res.status(parsed.response.status).json(parsed.response.body);
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsed.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsed.brandId}' was not found` });
    }

    const integrations = await adapter.listIntegrations(userId, parsed.brandId);
    return res.json(
      integrations.map(({ secretsEnc: _secretsEnc, ...rest }) => ({
        ...rest,
        secretsStored: Boolean(_secretsEnc),
      })),
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/buffer/connect", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.response.status).json(parsedBrand.response.body);
  }

  const parsedBody = bufferConnectSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid Buffer connect payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }

    const integration = await connectBufferIntegration(userId, parsedBrand.brandId, parsedBody.data);
    return res.json({
      ok: true,
      provider: "buffer",
      status: integration.status,
      brandId: parsedBrand.brandId,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/gbp/connect", async (req, res, next) => {
  const parsedBrand = parseBrandId(req.query.brandId);
  if (!parsedBrand.ok) {
    return res.status(parsedBrand.response.status).json(parsedBrand.response.body);
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrand.brandId);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrand.brandId}' was not found` });
    }

    const authUrl = createGoogleBusinessConnectUrl(userId, parsedBrand.brandId);

    if (req.query.redirect === "1") {
      return res.redirect(authUrl);
    }

    return res.json({ authUrl });
  } catch (error) {
    return next(error);
  }
});

router.get("/gbp/callback", async (req, res, next) => {
  const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
  const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
  if (!code || !state) {
    return res.status(400).json({ error: "Missing OAuth callback code/state" });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const integration = await completeGoogleBusinessOauth(userId, state, code);
    const redirectUrl = `/admin/integrations/gbp?brandId=${encodeURIComponent(
      integration.brandId,
    )}&status=connected`;

    if ((req.headers.accept ?? "").includes("text/html")) {
      return res.redirect(redirectUrl);
    }

    return res.json({
      ok: true,
      provider: "google_business",
      brandId: integration.brandId,
      status: integration.status,
      redirectUrl,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
