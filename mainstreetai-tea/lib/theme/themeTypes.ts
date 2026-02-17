export type TownTheme = {
  accent: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
};

export type TownThemeRecord = {
  townSlug: string;
  displayName: string;
  poweredByLine: string;
  logoUrl?: string;
  presenceLine: string;
  theme: TownTheme;
};

const DEFAULT_THEME: TownTheme = {
  accent: "#1F4E79",
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  text: "#111827",
  muted: "#6B7280",
  border: "rgba(17,24,39,0.08)",
};

const MOCK_TOWN_THEME_ROWS: Record<string, Partial<TownThemeRecord>> = {
  independence: {
    displayName: "Independence Local Network",
    presenceLine: "Neighbors are showing up across Main Street today.",
    theme: {
      accent: "#1F4E79",
      bg: "#F7F7F5",
      surface: "#FFFFFF",
      text: "#111827",
      muted: "#6B7280",
      border: "rgba(17,24,39,0.08)",
    },
  },
  springfield: {
    displayName: "Springfield Local Network",
    presenceLine: "Schools and small businesses are moving in rhythm this week.",
    theme: {
      accent: "#245E4F",
      bg: "#F6F7F4",
      surface: "#FFFFFF",
      text: "#111827",
      muted: "#64748B",
      border: "rgba(15,23,42,0.08)",
    },
  },
};

function cleanedSlug(value: string): string {
  return value.trim().toLowerCase();
}

function fallbackDisplayName(slug: string): string {
  const label = slug
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
  return `${label || "Town"} Local Network`;
}

function normalizedTheme(input: Partial<TownTheme> | undefined): TownTheme {
  return {
    accent: input?.accent?.trim() || DEFAULT_THEME.accent,
    bg: input?.bg?.trim() || DEFAULT_THEME.bg,
    surface: input?.surface?.trim() || DEFAULT_THEME.surface,
    text: input?.text?.trim() || DEFAULT_THEME.text,
    muted: input?.muted?.trim() || DEFAULT_THEME.muted,
    border: input?.border?.trim() || DEFAULT_THEME.border,
  };
}

export async function getTownThemeBySlug(townSlug: string): Promise<TownThemeRecord> {
  const slug = cleanedSlug(townSlug);
  const row = MOCK_TOWN_THEME_ROWS[slug];

  // Replace this map with a real town_theme table read when connected.
  return {
    townSlug: slug,
    displayName: row?.displayName?.trim() || fallbackDisplayName(slug),
    poweredByLine: "Powered by your Chamber",
    logoUrl: row?.logoUrl,
    presenceLine: row?.presenceLine?.trim() || "Neighbors are showing up.",
    theme: normalizedTheme(row?.theme),
  };
}
