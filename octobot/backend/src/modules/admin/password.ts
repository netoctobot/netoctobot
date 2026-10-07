import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const N = 16_384;
const R = 8;
const P = 1;

function scrypt(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, { N, r: R, p: P }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return encodeHash(salt, key);
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<boolean> {
  const parsed = stored ? parseHash(stored) : null;
  const salt = parsed?.salt ?? randomBytes(SALT_LENGTH);
  const expected = parsed?.key ?? randomBytes(KEY_LENGTH);
  const actual = await scrypt(password, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }
  const matches = timingSafeEqual(actual, expected);
  return parsed !== null && matches;
}

function encodeHash(salt: Buffer, key: Buffer): string {
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function parseHash(
  stored: string,
): { salt: Buffer; key: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return null;
  }
  if (Number(parts[1]) !== N || Number(parts[2]) !== R || Number(parts[3]) !== P) {
    return null;
  }
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const key = Buffer.from(parts[5] ?? "", "base64url");
  if (salt.length !== SALT_LENGTH || key.length !== KEY_LENGTH) {
    return null;
  }
  return { salt, key };
}
