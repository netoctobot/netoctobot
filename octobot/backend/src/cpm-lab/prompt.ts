import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { LoginPrompt } from "./login.js";

/** Hidden answers are not echoed, and no answer is logged or kept after it is returned. */
export function createTtyPrompt(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): LoginPrompt {
  let muted = false;
  const sink = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        output.write(chunk, encoding as BufferEncoding);
      }
      callback();
    },
  });
  const interactive = Boolean(input.isTTY);
  const rl = createInterface({ input, output: sink, terminal: interactive });

  const question = (label: string, hidden: boolean) =>
    new Promise<string>((resolve) => {
      output.write(label);
      muted = hidden;
      rl.question("", (answer) => {
        muted = false;
        if (hidden) {
          output.write("\n");
        }
        resolve(answer.trim());
      });
    });

  return {
    interactive,
    ask: (label) => question(label, false),
    askHidden: (label) => question(label, true),
    close: () => rl.close(),
  };
}
