import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import {
  channelLinkStateKey,
  clearChannelLinkState,
  getChannelLinkState,
  saveChannelLinkState,
} from "./channel-link-state.js";

class FakeRedis {
  readonly values = new Map<string, string>();
  lastExpiry: number | null = null;

  async set(
    key: string,
    value: string,
    mode: string,
    expiry: number,
  ): Promise<"OK"> {
    assert.equal(mode, "EX");
    this.values.set(key, value);
    this.lastExpiry = expiry;
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

function redis(value: FakeRedis): Redis {
  return value as unknown as Redis;
}

test("isolates manual channel-link state by bot and user", () => {
  assert.notEqual(
    channelLinkStateKey("bot-a", 123),
    channelLinkStateKey("bot-b", 123),
  );
  assert.notEqual(
    channelLinkStateKey("bot-a", 123),
    channelLinkStateKey("bot-a", 456),
  );
});

test("stores state with a ten-minute expiry and clears it", async () => {
  const fake = new FakeRedis();

  await saveChannelLinkState(redis(fake), "bot-a", 123, {
    chatId: 123,
  });

  assert.equal(fake.lastExpiry, 600);
  assert.deepEqual(
    await getChannelLinkState(redis(fake), "bot-a", 123),
    { chatId: 123 },
  );

  await clearChannelLinkState(redis(fake), "bot-a", 123);
  assert.equal(
    await getChannelLinkState(redis(fake), "bot-a", 123),
    null,
  );
});

test("discards malformed state", async () => {
  const fake = new FakeRedis();
  const key = channelLinkStateKey("bot-a", 123);
  fake.values.set(key, JSON.stringify({ chatId: "wrong" }));

  assert.equal(
    await getChannelLinkState(redis(fake), "bot-a", 123),
    null,
  );
  assert.equal(fake.values.has(key), false);
});
