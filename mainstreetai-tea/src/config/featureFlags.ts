function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export const FEATURES = {
  autopilot: envFlag("FEATURE_AUTOPILOT", true),
  sms: envFlag("FEATURE_SMS", true),
  gbp: envFlag("FEATURE_GBP", true),
  billing: envFlag("FEATURE_BILLING", true),
  teams: envFlag("FEATURE_TEAMS", true),
  marketing: envFlag("FEATURE_MARKETING", true),
  demoMode: envFlag("FEATURE_DEMO_MODE", true),
} as const;
