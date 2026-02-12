import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  brandIdSchema,
  brandProfileSchema,
  brandRegistrySchema,
  type BrandProfile,
  type BrandRegistryItem,
} from "../schemas/brandSchema";

const BRANDS_DIR = path.resolve(process.cwd(), "data", "brands");
const INDEX_PATH = path.join(BRANDS_DIR, "index.json");

function brandFilePath(brandId: string): string {
  return path.join(BRANDS_DIR, `${brandId}.json`);
}

function toRegistryItem(profile: BrandProfile): BrandRegistryItem {
  return {
    brandId: profile.brandId,
    businessName: profile.businessName,
    location: profile.location,
    type: profile.type,
  };
}

async function ensureBrandsDir(): Promise<void> {
  await mkdir(BRANDS_DIR, { recursive: true });
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function scanBrandsFromFiles(): Promise<BrandRegistryItem[]> {
  await ensureBrandsDir();

  const entries = await readdir(BRANDS_DIR, { withFileTypes: true });
  const brandFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const items: BrandRegistryItem[] = [];
  for (const fileName of brandFiles) {
    const profile = await readJsonFile(path.join(BRANDS_DIR, fileName));
    const parsedProfile = brandProfileSchema.parse(profile);
    items.push(toRegistryItem(parsedProfile));
  }

  return items;
}

export async function listBrands(): Promise<BrandRegistryItem[]> {
  try {
    const parsedIndex = brandRegistrySchema.parse(await readJsonFile(INDEX_PATH));
    return parsedIndex;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code !== "ENOENT"
    ) {
      // If index exists but is malformed, we rebuild from profile files.
    }
  }

  const scanned = await scanBrandsFromFiles();
  await writeJsonFile(INDEX_PATH, scanned);
  return scanned;
}

export async function getBrand(brandId: string): Promise<BrandProfile | null> {
  const validatedBrandId = brandIdSchema.parse(brandId);

  try {
    const parsed = brandProfileSchema.parse(await readJsonFile(brandFilePath(validatedBrandId)));
    if (parsed.brandId !== validatedBrandId) {
      throw new Error(`Brand file mismatch for ${validatedBrandId}`);
    }
    return parsed;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export async function createBrand(brand: BrandProfile): Promise<BrandProfile | null> {
  await ensureBrandsDir();

  const existing = await getBrand(brand.brandId);
  if (existing) {
    return null;
  }

  await writeJsonFile(brandFilePath(brand.brandId), brand);
  await syncBrandIndex();
  return brand;
}

export async function updateBrand(
  brandId: string,
  updatedBrand: BrandProfile,
): Promise<BrandProfile | null> {
  await ensureBrandsDir();

  const existing = await getBrand(brandId);
  if (!existing) {
    return null;
  }

  await writeJsonFile(brandFilePath(brandId), updatedBrand);
  await syncBrandIndex();
  return updatedBrand;
}

export async function deleteBrand(brandId: string): Promise<boolean> {
  const validatedBrandId = brandIdSchema.parse(brandId);

  try {
    await rm(brandFilePath(validatedBrandId));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }

  await syncBrandIndex();
  return true;
}

export async function syncBrandIndex(): Promise<BrandRegistryItem[]> {
  const scanned = await scanBrandsFromFiles();
  await writeJsonFile(INDEX_PATH, scanned);
  return scanned;
}
