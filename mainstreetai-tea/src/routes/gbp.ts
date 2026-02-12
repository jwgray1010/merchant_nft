import { Router } from "express";
import { brandIdSchema } from "../schemas/brandSchema";
import { gbpPostSchema } from "../schemas/gbpSchema";
import { getAdapter } from "../storage/getAdapter";
import { getGoogleBusinessProvider } from "../integrations/providerFactory";

const router = Router();

router.post("/post", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /gbp/post?brandId=main-street-nutrition",
    });
  }

  const parsedBrandId = brandIdSchema.safeParse(rawBrandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId query parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = gbpPostSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid GBP post payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adapter = getAdapter();
    const brand = await adapter.getBrand(userId, parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const provider = await getGoogleBusinessProvider(userId, parsedBrandId.data);
    const result = await provider.createPost(parsedBody.data);
    await adapter.addHistory(userId, parsedBrandId.data, "gbp-post", parsedBody.data, result);

    return res.json({
      status: "sent",
      result,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
