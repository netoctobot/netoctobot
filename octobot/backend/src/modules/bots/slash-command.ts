export const PRIVATE_HOME_COMMAND_PATTERN =
  /^\/(?:start|cancel)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i;

export function isPrivateSlashCommand(
  text: string | undefined,
  command: "start" | "cancel",
): boolean {
  if (!text) {
    return false;
  }
  return new RegExp(
    `^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s|$)`,
    "i",
  ).test(text);
}
