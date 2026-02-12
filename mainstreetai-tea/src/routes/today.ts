import { Router } from "express";
import { getBrand } from "../data/brandStore";
import { brandIdSchema } from "../schemas/brandSchema";
import { buildTodayTasks } from "../services/todayService";

const router = Router();

router.get("/", async (req, res, next) => {
  const rawBrandId = req.query.brandId;
  if (typeof rawBrandId !== "string" || rawBrandId.trim() === "") {
    return res.status(400).json({
      error: "Missing brandId query parameter. Example: /today?brandId=main-street-nutrition",
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
    const brand = await getBrand(parsedBrandId.data);
    if (!brand) {
      return res.status(404).json({ error: `Brand '${parsedBrandId.data}' was not found` });
    }

    const payload = await buildTodayTasks(parsedBrandId.data);
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
