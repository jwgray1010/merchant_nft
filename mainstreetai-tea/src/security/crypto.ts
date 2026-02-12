import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKeyBytes(): Buffer {
  const raw = process.env.INTEGRATION_SECRET_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("INTEGRATION_SECRET_KEY must be set and at least 32 characters long");
  }
  return createHash("sha256").update(raw).digest();
}

export function encrypt(text: string): string {
  const key = getKeyBytes();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const key = getKeyBytes();
  const [ivRaw, authTagRaw, dataRaw] = payload.split(".");
  if (!ivRaw || !authTagRaw || !dataRaw) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(ivRaw, "base64");
  const authTag = Buffer.from(authTagRaw, "base64");
  const encrypted = Buffer.from(dataRaw, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
