import { createHmac, timingSafeEqual } from "node:crypto";

function requireStateSecret(): string {
  const secret = process.env.INTEGRATION_SECRET_KEY;
  if (!secret || secret.trim().length < 32) {
    throw new Error("INTEGRATION_SECRET_KEY must be set and at least 32 characters");
  }
  return secret;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payloadBase64Url: string): string {
  const secret = requireStateSecret();
  return createHmac("sha256", secret).update(payloadBase64Url).digest("base64url");
}

export function createSignedState(payload: Record<string, unknown>): string {
  const payloadEncoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifySignedState<TPayload>(token: string): TPayload {
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    throw new Error("Invalid state token format");
  }

  const expected = sign(payloadEncoded);
  const providedBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid state token signature");
  }

  const parsed = JSON.parse(fromBase64Url(payloadEncoded)) as TPayload;
  return parsed;
}
