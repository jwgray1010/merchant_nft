import { runPrompt } from "../ai/runPrompt";
import type { AutopilotGoal } from "../schemas/autopilotSettingsSchema";
import {
  mediaAnalyzeRequestSchema,
  type MediaAnalyzeRequest,
  type MediaAnalysis,
  type MediaAsset,
  type MediaPlatform,
  visualReviewOutputSchema,
} from "../schemas/mediaSchema";
import { getAdapter } from "../storage/getAdapter";
import { getLocationById } from "./locationStore";
import {
  addMediaAnalysis,
  addMediaAsset,
  getMediaAssetById,
  listMediaAssets,
} from "./mediaStore";
import { getBrandVoiceProfile } from "./voiceStore";

export async function analyzeMediaForBrand(input: {
  userId: string;
  brandId: string;
  request: MediaAnalyzeRequest;
  locationId?: string;
}): Promise<{
  asset: MediaAsset;
  analysis: MediaAnalysis["analysis"];
  analysisRecord: MediaAnalysis;
}> {
  const parsed = mediaAnalyzeRequestSchema.parse(input.request);
  const adapter = getAdapter();
  const brand = await adapter.getBrand(input.userId, input.brandId);
  if (!brand) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }

  const asset = parsed.assetId
    ? await getMediaAssetById(input.userId, input.brandId, parsed.assetId)
    : await addMediaAsset(input.userId, input.brandId, {
        kind: "image",
        source: "url",
        url: parsed.imageUrl as string,
        locationId: input.locationId,
      });

  if (!asset) {
    throw new Error(`Asset '${parsed.assetId}' was not found`);
  }

  const location = input.locationId
    ? await getLocationById(input.userId, input.brandId, input.locationId)
    : asset.locationId
      ? await getLocationById(input.userId, input.brandId, asset.locationId)
      : null;
  const voiceProfile = await getBrandVoiceProfile(input.userId, input.brandId).catch(() => null);

  const analysis = await runPrompt({
    promptFile: "visual_review.md",
    brandProfile: brand,
    userId: input.userId,
    locationContext: location
      ? {
          id: location.id,
          name: location.name,
          address: location.address,
          timezone: location.timezone,
        }
      : undefined,
    imageUrls: [asset.url],
    input: {
      brand,
      platform: parsed.platform,
      imageContext: parsed.imageContext ?? "",
      goals: parsed.goals,
      voiceProfile: voiceProfile
        ? {
            styleSummary: voiceProfile.styleSummary,
            emojiStyle: voiceProfile.emojiStyle,
            energyLevel: voiceProfile.energyLevel,
            phrasesToRepeat: voiceProfile.phrasesToRepeat,
            doNotUse: voiceProfile.doNotUse,
          }
        : undefined,
    },
    outputSchema: visualReviewOutputSchema,
  });

  const analysisRecord = await addMediaAnalysis(input.userId, input.brandId, {
    assetId: asset.id,
    platform: parsed.platform,
    analysis,
  });

  return {
    asset,
    analysis,
    analysisRecord,
  };
}

export async function findLatestMediaAssetForBrand(
  userId: string,
  brandId: string,
  options?: { locationId?: string; preferredKind?: "image" | "thumbnail" | "video" },
): Promise<MediaAsset | null> {
  const assets = await listMediaAssets(userId, brandId, 40);
  const filtered = assets
    .filter((asset) => (options?.locationId ? asset.locationId === options.locationId : true))
    .filter((asset) => (options?.preferredKind ? asset.kind === options.preferredKind : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filtered[0] ?? null;
}

export async function quickAutopilotVisualHints(input: {
  userId: string;
  brandId: string;
  platform: MediaPlatform;
  goals: AutopilotGoal[];
  locationId?: string;
}): Promise<
  | {
      assetId: string;
      onScreenTextOptions: string[];
      croppingSuggestions: string[];
      hookIdeas: string[];
    }
  | null
> {
  const asset = await findLatestMediaAssetForBrand(input.userId, input.brandId, {
    locationId: input.locationId,
    preferredKind: "image",
  });
  if (!asset) {
    return null;
  }
  const result = await analyzeMediaForBrand({
    userId: input.userId,
    brandId: input.brandId,
    locationId: input.locationId,
    request: {
      assetId: asset.id,
      platform: input.platform,
      goals: input.goals,
      imageContext: "Autopilot quick visual pass",
    },
  });
  return {
    assetId: asset.id,
    onScreenTextOptions: result.analysis.onScreenTextOptions,
    croppingSuggestions: result.analysis.croppingSuggestions,
    hookIdeas: result.analysis.hookIdeas,
  };
}
