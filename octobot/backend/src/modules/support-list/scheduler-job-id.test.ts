import assert from "node:assert/strict";
import test from "node:test";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { deleteJobId, publishJobId } from "./scheduler.js";

const CYCLE_ID = "cmuwm4f3j002kjselo8w9yvob";

test("publish and delete job ids are accepted by BullMQ", async () => {
  const publishId = publishJobId(CYCLE_ID);
  const deleteId = deleteJobId(CYCLE_ID);
  assert.equal(publishId, `publish-${CYCLE_ID}`);
  assert.equal(deleteId, `delete-${CYCLE_ID}`);
  assert.equal(publishId.includes(":"), false);
  assert.equal(deleteId.includes(":"), false);

  const connection = new Redis("redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue("support-list-job-id-test", { connection });
  try {
    await assert.rejects(
      queue.add("publish", { cycleId: CYCLE_ID }, { jobId: `publish:${CYCLE_ID}` }),
      /Custom Id cannot contain :/,
    );
    const job = await queue.add(
      "publish",
      { cycleId: CYCLE_ID },
      { jobId: publishId, delay: 60_000 },
    );
    assert.equal(job.id, publishId);
    const again = await queue.add(
      "publish",
      { cycleId: CYCLE_ID },
      { jobId: publishId, delay: 60_000 },
    );
    assert.equal(again.id, publishId);
  } finally {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  }
});
