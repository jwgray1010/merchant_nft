import { Router } from "express";
import { buildBrandFromTemplate } from "../data/templateStore";
import { brandFromTemplateRequestSchema } from "../schemas/brandTemplateSchema";
import { brandIdSchema, brandProfileSchema } from "../schemas/brandSchema";
import { getAdapter } from "../storage/getAdapter";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const userId = _req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const brands = await getAdapter().listBrands(userId);
    return res.json(brands);
  } catch (error) {
    return next(error);
  }
});

router.get("/:brandId", async (req, res, next) => {
  const parsedBrandId = brandIdSchema.safeParse(req.params.brandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId route parameter",
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
    return res.json(brand);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  const parsedBody = brandProfileSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid brand profile",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const created = await getAdapter().createBrand(userId, parsedBody.data);
    if (!created) {
      return res.status(409).json({
        error: `Brand '${parsedBody.data.brandId}' already exists`,
      });
    }

    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post("/from-template", async (req, res, next) => {
  const parsedBody = brandFromTemplateRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid from-template payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    const brandProfile = await buildBrandFromTemplate(parsedBody.data);
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const created = await getAdapter().createBrand(userId, brandProfile);
    if (!created) {
      return res.status(409).json({
        error: `Brand '${brandProfile.brandId}' already exists`,
      });
    }

    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.put("/:brandId", async (req, res, next) => {
  const parsedBrandId = brandIdSchema.safeParse(req.params.brandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId route parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  const parsedBody = brandProfileSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid brand profile",
      details: parsedBody.error.flatten(),
    });
  }

  if (parsedBody.data.brandId !== parsedBrandId.data) {
    return res.status(400).json({
      error: "Route brandId must match body brandId",
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const updated = await getAdapter().updateBrand(userId, parsedBrandId.data, parsedBody.data);
    if (!updated) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.delete("/:brandId", async (req, res, next) => {
  const parsedBrandId = brandIdSchema.safeParse(req.params.brandId);
  if (!parsedBrandId.success) {
    return res.status(400).json({
      error: "Invalid brandId route parameter",
      details: parsedBrandId.error.flatten(),
    });
  }

  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const deleted = await getAdapter().deleteBrand(userId, parsedBrandId.data);
    if (!deleted) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
