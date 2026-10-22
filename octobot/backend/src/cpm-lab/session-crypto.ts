import { decryptToken, encryptToken } from "../lib/token-crypto.js";

export class LabKeyConflictError extends Error {
  constructor() {
    super("Lab session key must be independent from the application encryption key");
    this.name = "LabKeyConflictError";
  }
}

export function assertDistinctLabKey(
  labKey: string,
  applicationKey: string | undefined,
): void {
  if (
    applicationKey !== undefined &&
    labKey.toLowerCase() === applicationKey.toLowerCase()
  ) {
    throw new LabKeyConflictError();
  }
}

export function encryptLabSession(
  session: string,
  labKey: string,
  applicationKey?: string,
): string {
  assertDistinctLabKey(labKey, applicationKey);
  return encryptToken(session, labKey);
}

export function decryptLabSession(
  ciphertext: string,
  labKey: string,
  applicationKey?: string,
): string {
  assertDistinctLabKey(labKey, applicationKey);
  return decryptToken(ciphertext, labKey);
}
