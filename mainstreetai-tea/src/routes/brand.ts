import { Router } from "express";
import {
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  updateBrand,
} from "../data/brandStore";
import { brandIdSchema, brandProfileSchema } from "../schemas/brandSchema";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    const brands = await listBrands();
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
    const brand = await getBrand(parsedBrandId.data);
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
    const created = await createBrand(parsedBody.data);
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
    const updated = await updateBrand(parsedBrandId.data, parsedBody.data);
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
    const deleted = await deleteBrand(parsedBrandId.data);
    if (!deleted) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
