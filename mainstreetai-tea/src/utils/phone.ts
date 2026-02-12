function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

export function normalizeUSPhone(input: string): string {
  const raw = input.trim();
  if (raw === "") {
    throw new Error("Phone number is required");
  }

  const digits = digitsOnly(raw);
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  throw new Error("Phone must be a valid US 10-digit number (or +1 format)");
}
