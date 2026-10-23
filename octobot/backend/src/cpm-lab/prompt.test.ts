import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createTtyPrompt } from "./prompt.js";

test("closing the prompt rejects a question that is still waiting", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompt = createTtyPrompt(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream);
  const pending = prompt.askHidden("Login code (hidden): ");
  prompt.close();
  await assert.rejects(pending, /PROMPT_CLOSED/);
  await assert.rejects(prompt.ask("again: "), /PROMPT_CLOSED/);
});
