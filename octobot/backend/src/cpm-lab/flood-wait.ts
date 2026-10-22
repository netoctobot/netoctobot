export async function honorFloodWait(
  seconds: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("FLOOD_WAIT seconds must be a non-negative integer");
  }
  await sleep(seconds * 1000);
}
