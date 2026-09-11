import crypto from "crypto";

export function normalizeEmail(email: string): string {
  if (!email || typeof email !== "string") {
    throw new Error("Invalid email input");
  }

  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid email format: ${email}`);
  }

  const [localPart, domain] = parts;
  return `${localPart}@${domain}`;
}

export function normalizePhone(phone: string, defaultCountryCode = "+1"): string {
  if (!phone || typeof phone !== "string") {
    throw new Error("Invalid phone input");
  }

  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, "");

  if (cleaned.startsWith("00")) {
    cleaned = "+" + cleaned.substring(2);
  } else if (!cleaned.startsWith("+")) {
    cleaned = `${defaultCountryCode}${cleaned.replace(/^0+/, "")}`;
  }

  const digitsOnly = cleaned.replace(/\D/g, "");
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    throw new Error(`Invalid phone number length: ${phone}`);
  }

  return cleaned;
}

export function hashIdentityValue(normalizedValue: string): string {
  return crypto.createHash("sha256").update(normalizedValue).digest("hex");
}

export function encryptValue(value: string, secretKey: string = process.env.ENCRYPTION_SECRET || "default_secret_32_bytes_long_123"): string {
  const key = crypto.createHash("sha256").update(secretKey).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptValue(encryptedValue: string, secretKey: string = process.env.ENCRYPTION_SECRET || "default_secret_32_bytes_long_123"): string {
  try {
    const parts = encryptedValue.split(":");
    if (parts.length !== 2) return encryptedValue;
    const [ivHex, cipherHex] = parts;
    const key = crypto.createHash("sha256").update(secretKey).digest();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return encryptedValue;
  }
}
