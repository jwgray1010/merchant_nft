export type BrandScopedCollection = "history" | "posts" | "metrics";

export type SavedRecordMeta = {
  id: string;
  filePath: string;
};

export type SaveBrandRecordOptions<TRecord> = {
  collection: BrandScopedCollection;
  brandId: string;
  record: TRecord;
  fileSuffix?: string;
};

export type ListBrandRecordsOptions = {
  collection: BrandScopedCollection;
  brandId: string;
  limit?: number;
};

export type GetBrandRecordByIdOptions = {
  collection: BrandScopedCollection;
  brandId: string;
  id: string;
};

export interface Storage {
  saveBrandRecord<TRecord>(options: SaveBrandRecordOptions<TRecord>): Promise<SavedRecordMeta>;
  listBrandRecords<TRecord>(options: ListBrandRecordsOptions): Promise<TRecord[]>;
  getBrandRecordById<TRecord>(options: GetBrandRecordByIdOptions): Promise<TRecord | null>;
  writeBrandInsight<TRecord>(brandId: string, record: TRecord): Promise<void>;
  readBrandInsight<TRecord>(brandId: string): Promise<TRecord | null>;
}

export function buildTimestampForFile(date = new Date()): string {
  return date.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
}
