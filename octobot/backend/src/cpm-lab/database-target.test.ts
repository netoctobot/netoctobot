import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDistinctLabDatabase,
  LabDatabaseTargetError,
} from "./database-target.js";

const APP_PASSWORD = "app-secret-value";
const LAB_PASSWORD = "lab-secret-value";
const APP_URL = `postgresql://app_user:${APP_PASSWORD}@db.example:5432/octobot?schema=public&sslmode=require`;
const LAB_URL = `postgres://lab_user:${LAB_PASSWORD}@lab.example:5432/cpm_lab?schema=lab`;

function rejection(
  env: { LAB_DATABASE_URL?: string; DATABASE_URL?: string },
  options?: { requireAppDatabase?: boolean },
): LabDatabaseTargetError {
  try {
    assertDistinctLabDatabase(env, options);
  } catch (error) {
    assert.ok(error instanceof LabDatabaseTargetError);
    assert.equal(error.message.includes(APP_PASSWORD), false);
    assert.equal(error.message.includes(LAB_PASSWORD), false);
    assert.equal(error.message.includes("postgresql://"), false);
    assert.equal(error.message.includes("postgres://"), false);
    assert.equal(error.message.includes(APP_URL), false);
    assert.equal(error.message.includes(LAB_URL), false);
    return error;
  }
  assert.fail("expected the lab database target to be rejected");
}

test("a missing lab URL does not fall back to DATABASE_URL", () => {
  for (const labUrl of [undefined, "", "   "]) {
    const error = rejection({
      LAB_DATABASE_URL: labUrl,
      DATABASE_URL: APP_URL,
    });
    assert.equal(error.code, "missing");
    assert.match(error.message, /not used as a fallback/);
    assert.match(error.message, /host aliases/);
  }
});

test("the same host, port, and database are rejected when credentials differ", () => {
  const error = rejection({
    DATABASE_URL: APP_URL,
    LAB_DATABASE_URL: `postgresql://other_user:${LAB_PASSWORD}@DB.EXAMPLE/octobot?schema=cpm_lab&sslmode=disable`,
  });
  assert.equal(error.code, "same_database");
  assert.match(error.message, /host aliases/);
});

test("an omitted port matches the explicit default port", () => {
  const error = rejection({
    DATABASE_URL: "postgresql://app_user:app-secret-value@db.example/octobot",
    LAB_DATABASE_URL: `postgres://lab_user:${LAB_PASSWORD}@db.example:5432/octobot`,
  });
  assert.equal(error.code, "same_database");
});

test("a different database or port is accepted", () => {
  assert.equal(
    assertDistinctLabDatabase({
      DATABASE_URL: APP_URL,
      LAB_DATABASE_URL: LAB_URL,
    }),
    LAB_URL,
  );
  const otherPort = `postgresql://lab_user:${LAB_PASSWORD}@db.example:5433/octobot`;
  assert.equal(
    assertDistinctLabDatabase({
      DATABASE_URL: APP_URL,
      LAB_DATABASE_URL: otherPort,
    }),
    otherPort,
  );
});

test("localhost and 127.0.0.1 are not treated as the same host", () => {
  const labUrl = `postgresql://lab_user:${LAB_PASSWORD}@127.0.0.1:5432/octobot`;
  assert.equal(
    assertDistinctLabDatabase({
      DATABASE_URL: `postgresql://app_user:${APP_PASSWORD}@localhost:5432/octobot`,
      LAB_DATABASE_URL: labUrl,
    }),
    labUrl,
  );
});

test("a decoded database name matches a percent-encoded name", () => {
  const error = rejection({
    DATABASE_URL: "postgresql://app_user:app-secret-value@db.example/my-db",
    LAB_DATABASE_URL: `postgresql://lab_user:${LAB_PASSWORD}@db.example/my%2Ddb`,
  });
  assert.equal(error.code, "same_database");
});

test("an invalid lab URL and an empty host are rejected", () => {
  assert.equal(
    rejection({
      DATABASE_URL: APP_URL,
      LAB_DATABASE_URL: "http://lab.example/cpm_lab",
    }).code,
    "invalid",
  );
  assert.equal(
    rejection({
      LAB_DATABASE_URL: "postgresql:///cpm_lab?host=/var/run/postgresql",
    }).code,
    "invalid",
  );
});

test("an unparseable DATABASE_URL fails closed", () => {
  const error = rejection({
    DATABASE_URL: "not a database url",
    LAB_DATABASE_URL: LAB_URL,
  });
  assert.equal(error.code, "unparseable_app_database");
  assert.equal(error.message.includes("not a database url"), false);
});

test("lab migration requires a present and parseable application URL", () => {
  assert.equal(
    rejection(
      { LAB_DATABASE_URL: LAB_URL },
      { requireAppDatabase: true },
    ).code,
    "missing_app_database",
  );
  assert.equal(
    rejection(
      { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: "   " },
      { requireAppDatabase: true },
    ).code,
    "missing_app_database",
  );
  assert.equal(
    rejection(
      { LAB_DATABASE_URL: LAB_URL, DATABASE_URL: "not a database url" },
      { requireAppDatabase: true },
    ).code,
    "unparseable_app_database",
  );
});

test("an absent application URL does not block a valid lab URL", () => {
  assert.equal(
    assertDistinctLabDatabase({ LAB_DATABASE_URL: `  ${LAB_URL}  ` }),
    LAB_URL,
  );
});
