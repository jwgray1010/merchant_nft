import { runPrompt } from "../ai/runPrompt";
import type { BrandProfile } from "../schemas/brandSchema";
import {
  localTrustAssetsSchema,
  localTrustBadgeLabelSchema,
  localTrustVoiceOutputSchema,
  type LocalTrustAssets,
} from "../schemas/localTrustSchema";

function normalizeStyle(style: BrandProfile["localTrustStyle"] | undefined): "mainstreet" | "network" {
  return style === "network" ? "network" : "mainstreet";
}

function fallbackTrustLine(style: "mainstreet" | "network"): string {
  if (style === "network") {
    return "Thanks for supporting local today.";
  }
  return "Thanks for supporting local today.";
}

function fallbackReceiptLine(style: "mainstreet" | "network"): string {
  if (style === "network") {
    return "Thanks for supporting local.";
  }
  return "Thanks for supporting local.";
}

function fallbackStickerLine(style: "mainstreet" | "network"): string {
  if (style === "network") {
    return "Proudly Part of the Local Network";
  }
  return "Proudly Part of the Local Network";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildWindowStickerSvg(input: { title: string; line: string }): string {
  const title = escapeXml(input.title);
  const line = escapeXml(input.line);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="220" viewBox="0 0 640 220" role="img" aria-label="${title}">
  <rect x="10" y="10" width="620" height="200" rx="28" fill="#FFFFFF" stroke="#D9E7F6" stroke-width="2"/>
  <rect x="24" y="24" width="592" height="44" rx="20" fill="#E9F3FF"/>
  <text x="320" y="52" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="20" fill="#1F4E79">${title}</text>
  <text x="320" y="128" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="32" font-weight="600" fill="#0F172A">${line}</text>
  <text x="320" y="168" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="18" fill="#6B7280">Built for local ownership and community support</text>
</svg>`;
}

function buildSocialBadgeImage(input: { title: string }): string {
  const title = escapeXml(input.title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="${title}">
  <rect x="80" y="80" width="920" height="920" rx="96" fill="#FFFFFF" stroke="#D9E7F6" stroke-width="18"/>
  <rect x="140" y="210" width="800" height="120" rx="60" fill="#E9F3FF"/>
  <text x="540" y="288" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="52" fill="#1F4E79">${title}</text>
  <text x="540" y="490" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="88" font-weight="700" fill="#0F172A">Shop Local</text>
  <text x="540" y="600" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="64" fill="#0F172A">Support Community</text>
  <text x="540" y="760" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" font-size="42" fill="#6B7280">Main Street momentum, one small win at a time.</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function isLocalTrustEnabled(brand: BrandProfile): boolean {
  return brand.localTrustEnabled !== false;
}

export function localTrustBadgeLabelForBrand(brand: BrandProfile): string | null {
  if (!isLocalTrustEnabled(brand)) {
    return null;
  }
  const style = normalizeStyle(brand.localTrustStyle);
  return localTrustBadgeLabelSchema.parse(
    style === "network" ? "Local Network Member" : "Powered by Main Street",
  );
}

export async function generateLocalTrustLine(input: {
  brand: BrandProfile;
  userId?: string;
  useCase?: "daily_pack" | "receipt" | "signage";
}): Promise<string> {
  const style = normalizeStyle(input.brand.localTrustStyle);
  const fallback = fallbackTrustLine(style);

  if (!isLocalTrustEnabled(input.brand)) {
    return fallback;
  }

  const promptLine = await runPrompt({
    promptFile: "local_trust_voice.md",
    brandProfile: input.brand,
    userId: input.userId,
    input: {
      brandName: input.brand.businessName,
      location: input.brand.location,
      trustStyle: style,
      useCase: input.useCase ?? "daily_pack",
    },
    outputSchema: localTrustVoiceOutputSchema,
  })
    .then((result) => result.trustLine)
    .catch(() => fallback);

  const normalized = promptLine.trim();
  return normalized || fallback;
}

export async function generateLocalTrustAssets(input: {
  brand: BrandProfile;
  userId?: string;
}): Promise<LocalTrustAssets> {
  const style = normalizeStyle(input.brand.localTrustStyle);
  const title = localTrustBadgeLabelForBrand(input.brand) ?? "Local Network Member";
  const stickerLine = fallbackStickerLine(style);
  const receiptFallback = fallbackReceiptLine(style);
  const receiptLine = await generateLocalTrustLine({
    brand: input.brand,
    userId: input.userId,
    useCase: "receipt",
  }).catch(() => receiptFallback);

  return localTrustAssetsSchema.parse({
    windowStickerSVG: buildWindowStickerSvg({
      title,
      line: stickerLine,
    }),
    socialBadgePNG: buildSocialBadgeImage({ title }),
    receiptLine: receiptLine || receiptFallback,
  });
}
