import assert from "node:assert/strict";
import test from "node:test";
import { Api } from "teleproto";
import type { LabChannelConfig } from "./config.js";
import { classifyThrown, LabIntegrityError } from "./errors.js";
import {
  BotChannelReader,
  parseBotMessages,
  parseUserViews,
  UserViewsReader,
  type LabCallOptions,
  type LabRpc,
} from "./readers.js";

const CHANNEL: LabChannelConfig = {
  telegramChannelId: 1234567890n,
  postId: 42,
  username: "octolab_test",
  inviteHash: null,
};

class RecordingRpc implements LabRpc {
  readonly calls: Array<{ request: Api.AnyRequest; options: LabCallOptions }> = [];
  constructor(private readonly responses: unknown[]) {}
  async invokeLab(request: Api.AnyRequest, options: LabCallOptions) {
    this.calls.push({ request, options });
    return this.responses.shift();
  }
}

const channelChat = (accessHash: string | undefined, extra: Record<string, unknown> = {}) => ({
  className: "Channel",
  id: "1234567890",
  accessHash,
  ...extra,
});
const peer = (channelId = "1234567890") => ({ className: "PeerChannel", channelId });

test("bot reader resolves with access hash 0, then reads with explicit per-call options", async () => {
  const rpc = new RecordingRpc([
    { className: "messages.Chats", chats: [channelChat("777")] },
    { className: "messages.ChannelMessages", messages: [{ className: "Message", id: 42, peerId: peer(), views: 15 }] },
  ]);
  const reader = new BotChannelReader(rpc, CHANNEL);
  const signal = new AbortController().signal;
  await reader.resolve(signal);
  const observations = await reader.read([42], signal);
  assert.deepEqual(observations, [{ messageId: 42, views: 15, resultKind: "MESSAGE" }]);

  const [resolve, read] = rpc.calls;
  assert.ok(resolve?.request instanceof Api.channels.GetChannels);
  const resolveInput = (resolve.request as Api.channels.GetChannels).id[0] as Api.InputChannel;
  assert.equal(resolveInput.accessHash.toString(), "0");
  assert.ok(read?.request instanceof Api.channels.GetMessages);
  const readRequest = read.request as Api.channels.GetMessages;
  assert.equal((readRequest.channel as Api.InputChannel).accessHash.toString(), "777");
  assert.equal((readRequest.channel as Api.InputChannel).channelId.toString(), "1234567890");
  for (const call of rpc.calls) {
    assert.equal(call.options.maxRetryCount, 0);
    assert.equal(call.options.floodSleepThreshold, 0);
    assert.equal(call.options.timeout, 20_000);
    assert.equal(call.options.abortSignal, signal);
  }
});

test("user reader resolves the username in its own session and sends increment false", async () => {
  const rpc = new RecordingRpc([
    { className: "contacts.ResolvedPeer", peer: peer(), chats: [channelChat("999")], users: [] },
    { className: "messages.MessageViews", views: [{ className: "MessageViews", views: 15 }], chats: [], users: [] },
  ]);
  const reader = new UserViewsReader(rpc, CHANNEL);
  const signal = new AbortController().signal;
  await reader.resolve(signal);
  assert.deepEqual(await reader.read([42], signal), [{ messageId: 42, views: 15, resultKind: "MESSAGE" }]);
  const request = rpc.calls[1]?.request as Api.messages.GetMessagesViews;
  assert.ok(request instanceof Api.messages.GetMessagesViews);
  assert.equal(request.increment, false);
  assert.equal((request.peer as Api.InputPeerChannel).accessHash.toString(), "999");
  assert.deepEqual(request.id, [42]);
});

test("user reader accepts an invite only for an existing member and never joins", async () => {
  const member = new RecordingRpc([{ className: "ChatInviteAlready", chat: channelChat("555") }]);
  const withInvite = { ...CHANNEL, username: null, inviteHash: "AbCdEfGh12" };
  await new UserViewsReader(member, withInvite).resolve(new AbortController().signal);
  assert.ok(member.calls[0]?.request instanceof Api.messages.CheckChatInvite);

  const notMember = new RecordingRpc([{ className: "ChatInvite", title: "x" }]);
  await assert.rejects(
    new UserViewsReader(notMember, withInvite).resolve(new AbortController().signal),
    (error) => classifyThrown(error).errorClass === "CHANNEL_PRIVATE",
  );
  assert.equal(notMember.calls.length, 1);
  assert.throws(() => new UserViewsReader(notMember, { ...CHANNEL, username: null }), /LAB_CHANNEL_USERNAME/);
});

test("resolution rejects another peer, a forbidden channel, and a min access hash", async () => {
  const signal = new AbortController().signal;
  const wrongPeer = new RecordingRpc([{ className: "contacts.ResolvedPeer", peer: peer("1"), chats: [channelChat("1")] }]);
  await assert.rejects(new UserViewsReader(wrongPeer, CHANNEL).resolve(signal), LabIntegrityError);
  const forbidden = new RecordingRpc([{ className: "messages.Chats", chats: [{ className: "ChannelForbidden", id: "1234567890" }] }]);
  await assert.rejects(new BotChannelReader(forbidden, CHANNEL).resolve(signal), (error) => classifyThrown(error).errorClass === "CHANNEL_PRIVATE");
  const min = new RecordingRpc([{ className: "contacts.ResolvedPeer", peer: peer(), chats: [channelChat("1", { min: true })] }]);
  await assert.rejects(new UserViewsReader(min, CHANNEL).resolve(signal), LabIntegrityError);
});

test("bot response integrity: peer, count, missing id, empty message, absent views", () => {
  const ok = (messages: unknown[]) => ({ className: "messages.ChannelMessages", messages });
  assert.throws(() => parseBotMessages(ok([{ className: "Message", id: 42, peerId: peer("5"), views: 1 }]), 1234567890n, [42]), LabIntegrityError);
  assert.throws(() => parseBotMessages(ok([]), 1234567890n, [42]), /count/);
  assert.throws(() => parseBotMessages(ok([{ className: "Message", id: 41, peerId: peer(), views: 1 }]), 1234567890n, [42]), /missing/);
  assert.throws(() => parseBotMessages({ className: "messages.MessagesNotModified" }, 1234567890n, [42]), /unexpected/);
  assert.deepEqual(parseBotMessages(ok([{ className: "MessageEmpty", id: 42 }]), 1234567890n, [42]), [
    { messageId: 42, views: null, resultKind: "MESSAGE_EMPTY" },
  ]);
  assert.deepEqual(parseBotMessages(ok([{ className: "Message", id: 42, peerId: peer() }]), 1234567890n, [42]), [
    { messageId: 42, views: null, resultKind: "VIEWS_ABSENT" },
  ]);
});

test("user views integrity: length must match, absent views are recorded", () => {
  assert.throws(() => parseUserViews({ className: "messages.MessageViews", views: [] }, [42]), LabIntegrityError);
  assert.deepEqual(parseUserViews({ className: "messages.MessageViews", views: [{ className: "MessageViews" }] }, [42]), [
    { messageId: 42, views: null, resultKind: "VIEWS_ABSENT" },
  ]);
});
