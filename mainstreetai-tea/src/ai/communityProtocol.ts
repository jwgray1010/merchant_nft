type PathSegment = string | number;

const PRESERVE_KEY_PATTERN =
  /(id|url|email|phone|platform|status|window|season|day|hour|timezone|provider|type|actiontype|goal|level|signal|trend|style|source|role|location|brandref|ownerid|townref|createdat|updatedat|startedat|endedat)/i;

const REWRITE_RULES: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /\boptimi[sz]e\b/gi, replace: "improve" },
  { pattern: /\bleverage\b/gi, replace: "use" },
  { pattern: /\bmaximize\b/gi, replace: "strengthen" },
  { pattern: /\bstrategy\b/gi, replace: "plan" },
  { pattern: /\bdominate\b/gi, replace: "show up steadily" },
  { pattern: /\bcrush it\b/gi, replace: "keep it steady" },
  { pattern: /\bgo viral\b/gi, replace: "build steady momentum" },
  { pattern: /\bcompetitive advantage\b/gi, replace: "community momentum" },
  { pattern: /\bahead of others\b/gi, replace: "moving steadily together" },
  { pattern: /\boutperform\b/gi, replace: "stay steady" },
  { pattern: /\bneighbors are competitors\b/gi, replace: "neighbors are partners" },
];

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsPressureMetrics(value: string): boolean {
  return /\b\d+\s+(business(?:es)?|owners?|shops?|posts?)\b/i.test(value);
}

function looksLikeStructuredValue(value: string): boolean {
  if (!value) {
    return true;
  }
  if (/^https?:\/\//i.test(value)) {
    return true;
  }
  if (/^[a-f0-9-]{20,}$/i.test(value)) {
    return true;
  }
  if (/^[a-z0-9_-]{1,24}$/i.test(value) && !/\s/.test(value)) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return true;
  }
  return false;
}

function simplifyLength(value: string): string {
  if (value.length <= 220) {
    return value;
  }
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length <= 2) {
    return value.slice(0, 220).trim();
  }
  return `${sentences[0]} ${sentences[1]}`.trim().slice(0, 220).trim();
}

function shouldPreserveByPath(path: PathSegment[]): boolean {
  const joined = path
    .map((segment) => String(segment))
    .join(".")
    .toLowerCase();
  return PRESERVE_KEY_PATTERN.test(joined);
}

function polishStringValue(value: string): string {
  let next = normalizeSpacing(value);
  if (!next || looksLikeStructuredValue(next)) {
    return next;
  }
  for (const rule of REWRITE_RULES) {
    next = next.replace(rule.pattern, rule.replace);
  }
  if (containsPressureMetrics(next)) {
    next = "Neighbors are showing up today.";
  }
  next = next.replace(/!{2,}/g, "!");
  next = simplifyLength(next);
  return next.trim();
}

function deepPolish<T>(input: T, path: PathSegment[]): T {
  if (typeof input === "string") {
    if (shouldPreserveByPath(path)) {
      return input;
    }
    return polishStringValue(input) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((entry, index) => deepPolish(entry, [...path, index])) as unknown as T;
  }
  if (input && typeof input === "object") {
    const entries = Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      deepPolish(value, [...path, key]),
    ]);
    return Object.fromEntries(entries) as T;
  }
  return input;
}

export function applyCommunityPolish<T>(input: T): T {
  return deepPolish(input, []);
}

export function mainStreetTest(input: { text: string }): boolean {
  const value = normalizeSpacing(input.text);
  if (!value) {
    return true;
  }
  if (/\b(kpi|roi|funnel|conversion rate|market share)\b/i.test(value)) {
    return false;
  }
  return true;
}

export function presenceTest(input: { text: string }): boolean {
  const value = normalizeSpacing(input.text);
  if (!value) {
    return true;
  }
  if (/\b(ahead of|beat|rank|leaderboard|#\d+)\b/i.test(value)) {
    return false;
  }
  if (containsPressureMetrics(value)) {
    return false;
  }
  return true;
}

export function townTest(input: { text: string }): boolean {
  const value = normalizeSpacing(input.text);
  if (!value) {
    return true;
  }
  if (/\b(beat|dominate|steal)\s+(other|nearby|local)\s+(business|shop|owner)/i.test(value)) {
    return false;
  }
  if (/\b(leaderboard|ranking|bidding)\b/i.test(value)) {
    return false;
  }
  if (/\bjust your business\b/i.test(value) && /\bignore\b/i.test(value)) {
    return false;
  }
  return true;
}
