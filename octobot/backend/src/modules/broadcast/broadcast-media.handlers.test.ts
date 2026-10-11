import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import type { PrismaClient } from "@prisma/client";
import { registerBroadcastMediaRoutes } from "./broadcast-media.handlers.js";

function buildMultipartPayload(
  order: Array<"file" | "contentKind">,
  file: { content: Buffer; filename: string },
  contentKind = "PHOTO",
): { body: Buffer; contentType: string } {
  const boundary = "----octobot-test-boundary";
  const chunks: Buffer[] = [];
  for (const part of order) {
    if (part === "contentKind") {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="contentKind"\r\n\r\n${contentKind}\r\n`,
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: image/png\r\n\r\n`,
        ),
      );
      chunks.push(file.content);
      chunks.push(Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function minimalPng(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf[0] = 0x89;
  buf[1] = 0x50;
  buf[2] = 0x4e;
  buf[3] = 0x47;
  buf[4] = 0x0d;
  buf[5] = 0x0a;
  buf[6] = 0x1a;
  buf[7] = 0x0a;
  return buf;
}

async function createMediaApp(mediaRoot: string) {
  const prisma = {
    broadcastMediaAsset: {
      async create({ data }: { data: Record<string, unknown> }) {
        return {
          id: "media_test_1",
          contentKind: data.contentKind,
          originalName: data.originalName,
        };
      },
    },
  } as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  registerBroadcastMediaRoutes(app, {
    prisma,
    mediaRoot,
    requireAdmin: async () => ({ username: "tester" }),
  });
  await app.ready();
  return app;
}

test("POST /admin/broadcasts/media accepts PNG with file before contentKind (browser order)", async () => {
  const mediaRoot = await mkdtemp(path.join(tmpdir(), "broadcast-upload-"));
  const app = await createMediaApp(mediaRoot);
  const png = minimalPng(298 * 1024);
  const { body, contentType } = buildMultipartPayload(
    ["file", "contentKind"],
    { content: png, filename: "Screenshot.png" },
  );
  const response = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    payload: body,
    headers: { "content-type": contentType },
  });
  assert.equal(response.statusCode, 200);
  const json = response.json() as { mediaUploadId: string; originalName: string };
  assert.equal(json.mediaUploadId, "media_test_1");
  assert.equal(json.originalName, "Screenshot.png");
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

test("POST /admin/broadcasts/media rejects PNG without contentKind with a specific error", async () => {
  const mediaRoot = await mkdtemp(path.join(tmpdir(), "broadcast-upload-"));
  const app = await createMediaApp(mediaRoot);
  const png = minimalPng(512);
  const boundary = "----octobot-test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Screenshot.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(response.statusCode, 400);
  const json = response.json() as { error: string };
  assert.equal(json.error, "broadcast_media_missing_content_kind");
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

test("POST /admin/broadcasts/media accepts PNG when contentKind is only in query (proxy-safe)", async () => {
  const mediaRoot = await mkdtemp(path.join(tmpdir(), "broadcast-upload-"));
  const app = await createMediaApp(mediaRoot);
  const png = minimalPng(2048);
  const boundary = "----octobot-test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Screenshot.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    png,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media?contentKind=PHOTO",
    payload: body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  assert.equal(response.statusCode, 200, response.body);
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

test("POST /admin/broadcasts/media accepts PNG with contentKind before file", async () => {
  const mediaRoot = await mkdtemp(path.join(tmpdir(), "broadcast-upload-"));
  const app = await createMediaApp(mediaRoot);
  const png = minimalPng(4096);
  const { body, contentType } = buildMultipartPayload(
    ["contentKind", "file"],
    { content: png, filename: "Screenshot.png" },
  );
  const response = await app.inject({
    method: "POST",
    url: "/admin/broadcasts/media",
    payload: body,
    headers: { "content-type": contentType },
  });
  assert.equal(response.statusCode, 200, response.body);
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});
