function flag(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function isBufferEnabled(): boolean {
  return flag("ENABLE_BUFFER_INTEGRATION");
}

export function isTwilioEnabled(): boolean {
  return flag("ENABLE_TWILIO_INTEGRATION");
}

export function isGoogleBusinessEnabled(): boolean {
  return flag("ENABLE_GBP_INTEGRATION");
}

export function isEmailEnabled(): boolean {
  return flag("ENABLE_EMAIL_INTEGRATION");
}
