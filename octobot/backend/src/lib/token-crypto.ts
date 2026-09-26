import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function parseKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_BYTES) {
    throw new Error("Encryption key must be exactly 32 bytes");
  }
  return key;
}

export function encryptToken(
  token: string,
  keyHex: string,
  keyVersion = 1,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseKey(keyHex), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return [
    `v${keyVersion}`,
    iv.toString("base64url"),
    authenticationTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptToken(encrypted: string, keyHex: string): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] =
    encrypted.split(".");

  if (
    !version?.startsWith("v") ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded ||
    extra
  ) {
    throw new Error("Encrypted token has an invalid format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    parseKey(keyHex),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
