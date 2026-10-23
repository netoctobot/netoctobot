/** Commands that main.ts loads from live.ts through a dynamic import. "live" is not one of them. */
export const LIVE_COMMANDS = [
  "login-bot",
  "login-user",
  "preflight",
  "run",
  "clear-stop",
  "status",
  "report",
  "mark-view",
  "test-db",
] as const;

export type LiveCommand = (typeof LIVE_COMMANDS)[number];

/** These hold the advisory lock for their whole duration. */
export const LOCKED_COMMANDS: readonly LiveCommand[] = [
  "login-bot",
  "login-user",
  "preflight",
  "run",
  "clear-stop",
];

export function isLiveCommand(value: string): value is LiveCommand {
  return (LIVE_COMMANDS as readonly string[]).includes(value);
}
