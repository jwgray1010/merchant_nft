import { runPrompt } from "../ai/runPrompt";
import type { AutopilotGoal } from "../schemas/autopilotSettingsSchema";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  cameraCaptionOutputSchema,
  mediaAnalyzeRequestSchema,
  visualReviewOutputSchema,
  type CameraCaptionOutput,
  type MediaAnalyzeRequest,
  type MediaAnalysis,
  type MediaAsset,
  type MediaPlatform,
} from "../schemas/mediaSchema";
import { getAdapter } from "../storage/getAdapter";
import { getLocationById } from "./locationStore";
import {
  addMediaAnalysis,
  addMediaAsset,
  getMediaAssetById,
  listMediaAssets,
} from "./mediaStore";
import { generateLocalTrustLine, isLocalTrustEnabled } from "./localTrustService";
import { getTownPulseModelForBrand } from "./townPulseService";
import { getBrandVoiceProfile } from "./voiceStore";

function fallbackVisualAnalysis(input: { imageContext?: string }): MediaAnalysis["analysis"] {
  const context = input.imageContext?.trim() || "today's local highlight";
  return visualReviewOutputSchema.parse({
    quickScore: 7,
    whatWorks: [
      "Clear focal point around the main product or scene",
      "Natural lighting keeps the image approachable",
      "Simple framing fits mobile feeds",
    ],
    whatHurts: [
      "Could use a tighter crop for stronger focus",
      "Caption can be more specific about today's moment",
      "Text overlay should stay short for readability",
    ],
    croppingSuggestions: [
      "Center the key item and trim background distractions",
      "Keep horizon lines level for a cleaner look",
      "Leave a little top space for optional text overlay",
    ],
    lightingSuggestions: [
      "Slightly brighten shadows to reveal detail",
      "Add a gentle contrast lift to define edges",
      "Avoid heavy filters so colors stay natural",
    ],
    onScreenTextOptions: ["Fresh today", "Made local", "See you downtown"],
    hookIdeas: [
      "Fresh and ready right now.",
      "Quick local stop, real good energy.",
      `Today's pick: ${context}.`,
    ],
    captionRewrite: `Fresh local update: ${context}.`,
    hashtags: ["#shoplocal", "#mainstreet", "#supportlocal"],
  });
}

function fallbackCameraCaptionOutput(input: {
  imageContext?: string;
  townPulseLine?: string;
  trustLine?: string;
}): CameraCaptionOutput {
  const context = input.imageContext?.trim() || "fresh from today's counter";
  const base = `Fresh batch just hit the counter - ${context}.`;
  const pulse = input.townPulseLine?.trim();
  const trust = input.trustLine?.trim();
  const append = [pulse, trust].filter((line): line is string => Boolean(line)).join(" ");
  const master = append ? `${base} ${append}` : base;
  return cameraCaptionOutputSchema.parse({
    sceneDescription: "Fresh in-store moment captured from camera mode.",
    captionIdea: master,
    platformCaptions: {
      masterCaption: master,
      facebookCaption: master,
      instagramCaption: master,
      twitterCaption: master,
      googleCaption: `Fresh local update in-store today. ${append}`.trim(),
      tiktokHook: "Fresh local moment - come by today.",
      snapchatText: "Fresh local drop right now.",
    },
    signText: "Fresh in today - stop in and say hi.",
  });
}

function appendOptionalLine(base: string, line: string | undefined): string {
  const normalized = line?.trim();
  if (!normalized) {
    return base.trim();
  }
  if (base.toLowerCase().includes(normalized.toLowerCase())) {
    return base.trim();
  }
  return `${base.trim()} ${normalized}`.trim();
}

function applyOptionalLinesToCameraOutput(
  output: CameraCaptionOutput,
  input: { townPulseLine?: string; trustLine?: string },
): CameraCaptionOutput {
  const withTownPulse = (text: string) => appendOptionalLine(text, input.townPulseLine);
  const withTrust = (text: string) => appendOptionalLine(text, input.trustLine);
  return cameraCaptionOutputSchema.parse({
    ...output,
    captionIdea: withTrust(withTownPulse(output.captionIdea)),
    platformCaptions: {
      masterCaption: withTrust(withTownPulse(output.platformCaptions.masterCaption)),
      facebookCaption: withTrust(withTownPulse(output.platformCaptions.facebookCaption)),
      instagramCaption: withTrust(withTownPulse(output.platformCaptions.instagramCaption)),
      twitterCaption: withTrust(withTownPulse(output.platformCaptions.twitterCaption)),
      googleCaption: withTrust(withTownPulse(output.platformCaptions.googleCaption)),
      tiktokHook: withTrust(withTownPulse(output.platformCaptions.tiktokHook)),
      snapchatText: withTrust(withTownPulse(output.platformCaptions.snapchatText)),
    },
  });
}

function townPulseLineFromEnergy(energy: "low" | "medium" | "high" | undefined): string | undefined {
  if (energy === "high") {
    return "Town pulse is active today.";
  }
  if (energy === "medium") {
    return "Town pulse feels steady today.";
  }
  return undefined;
}

async function generateCameraCaptionPackForBrand(input: {
  userId: string;
  brandId: string;
  brand: BrandProfile;
  assetUrl: string;
  imageContext?: string;
  locationContext?: {
    id?: string;
    name?: string;
    address?: string;
    timezone?: string;
  };
}): Promise<CameraCaptionOutput> {
  const brandProfile = input.brand;
  if (!brandProfile) {
    throw new Error(`Brand '${input.brandId}' was not found`);
  }
  const [townPulse, trustLine] = await Promise.all([
    getTownPulseModelForBrand({
      userId: input.userId,
      brandId: input.brandId,
      recomputeIfMissing: true,
    }).catch(() => null),
    isLocalTrustEnabled(brandProfile)
      ? generateLocalTrustLine({
          brand: brandProfile,
          userId: input.userId,
          useCase: "daily_pack",
        }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);
  const townPulseLine = townPulseLineFromEnergy(townPulse?.model.eventEnergy);

  const generated = await runPrompt({
    promptFile: "camera_caption.md",
    brandProfile,
    userId: input.userId,
    locationContext: input.locationContext,
    imageUrls: [input.assetUrl],
    input: {
      brand: brandProfile,
      mediaUrl: input.assetUrl,
      sceneHint: input.imageContext ?? null,
      townPulseLine: townPulseLine ?? null,
      localTrustLine: trustLine ?? null,
    },
    outputSchema: cameraCaptionOutputSchema,
  }).catch(() =>
    fallbackCameraCaptionOutput({
      imageContext: input.imageContext,
      townPulseLine,
      trustLine,
    }),
  );

  return applyOptionalLinesToCameraOutput(generated, {
    townPulseLine,
    trustLine,
  });
}

export async function analyzeMediaForBrand(input: {
  userId: string;
  brandId: string;
  request: MediaAnalyzeRequest;
  locationId?: string;
}): Promise<{
  asset: MediaAsset;
  analysis: MediaAnalysis["analysis"];
  analysisRecord: MediaAnalysis;
  cameraPack?: CameraCaptionOutput;
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
        kind: parsed.mediaKind ?? "image",
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
      mediaKind: parsed.mediaKind ?? asset.kind,
    },
    outputSchema: visualReviewOutputSchema,
  }).catch(() => fallbackVisualAnalysis({ imageContext: parsed.imageContext }));

  const analysisRecord = await addMediaAnalysis(input.userId, input.brandId, {
    assetId: asset.id,
    platform: parsed.platform,
    analysis,
  });

  const cameraPack = parsed.cameraMode
    ? await generateCameraCaptionPackForBrand({
        userId: input.userId,
        brandId: input.brandId,
        brand,
        assetUrl: asset.url,
        imageContext: parsed.imageContext,
        locationContext: location
          ? {
              id: location.id,
              name: location.name,
              address: location.address,
              timezone: location.timezone,
            }
          : undefined,
      }).catch(() =>
        fallbackCameraCaptionOutput({
          imageContext: parsed.imageContext,
        }),
      )
    : undefined;

  return {
    asset,
    analysis,
    analysisRecord,
    cameraPack,
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
