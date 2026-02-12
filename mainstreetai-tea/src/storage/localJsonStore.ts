import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTimestampForFile,
  type GetBrandRecordByIdOptions,
  type ListBrandRecordsOptions,
  type SaveBrandRecordOptions,
  type SavedRecordMeta,
  type Storage,
} from "./storage";

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export class LocalJsonStore implements Storage {
  private readonly dataDir: string;

  constructor(dataDir = path.resolve(process.cwd(), "data")) {
    this.dataDir = dataDir;
  }

  async saveBrandRecord<TRecord>({
    collection,
    brandId,
    record,
    fileSuffix,
  }: SaveBrandRecordOptions<TRecord>): Promise<SavedRecordMeta> {
    const directory = path.join(this.dataDir, collection, brandId);
    await mkdir(directory, { recursive: true });

    const timestamp = buildTimestampForFile();
    const suffix = fileSuffix ? `_${fileSuffix}` : "";
    const fileName = `${timestamp}${suffix}.json`;
    const filePath = path.join(directory, fileName);

    await this.atomicWriteJson(filePath, record);

    return {
      id: fileName.replace(/\.json$/i, ""),
      filePath,
    };
  }

  async listBrandRecords<TRecord>({
    collection,
    brandId,
    limit = 100,
  }: ListBrandRecordsOptions): Promise<TRecord[]> {
    const directory = path.join(this.dataDir, collection, brandId);

    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const selected = files
      .filter((name) => name.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);

    const records = await Promise.all(
      selected.map(async (fileName) => {
        const raw = await readFile(path.join(directory, fileName), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          !("id" in parsed) &&
          !Array.isArray(parsed)
        ) {
          return {
            ...parsed,
            id: fileName.replace(/\.json$/i, ""),
          } as TRecord;
        }
        return parsed as TRecord;
      }),
    );

    return records;
  }

  async getBrandRecordById<TRecord>({
    collection,
    brandId,
    id,
  }: GetBrandRecordByIdOptions): Promise<TRecord | null> {
    const directory = path.join(this.dataDir, collection, brandId);

    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }

    const normalizedId = id.trim();
    if (normalizedId === "") {
      return null;
    }

    const directFile = path.join(directory, `${normalizedId}.json`);
    try {
      const raw = await readFile(directFile, "utf8");
      return JSON.parse(raw) as TRecord;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }

    for (const fileName of files.filter((name) => name.endsWith(".json")).sort((a, b) => b.localeCompare(a))) {
      const raw = await readFile(path.join(directory, fileName), "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (typeof parsed === "object" && parsed !== null && "id" in parsed) {
        const parsedId = (parsed as { id?: unknown }).id;
        if (typeof parsedId === "string" && parsedId === normalizedId) {
          return parsed as TRecord;
        }
      }

      if (fileName.replace(/\.json$/i, "") === normalizedId) {
        return parsed as TRecord;
      }
    }

    return null;
  }

  async writeBrandInsight<TRecord>(brandId: string, record: TRecord): Promise<void> {
    const directory = path.join(this.dataDir, "insights");
    await mkdir(directory, { recursive: true });

    const filePath = path.join(directory, `${brandId}.json`);
    await this.atomicWriteJson(filePath, record);
  }

  async readBrandInsight<TRecord>(brandId: string): Promise<TRecord | null> {
    const filePath = path.join(this.dataDir, "insights", `${brandId}.json`);

    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as TRecord;
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(temporaryPath, serialized, "utf8");
    await rename(temporaryPath, filePath);
  }
}

export const localJsonStore = new LocalJsonStore();
