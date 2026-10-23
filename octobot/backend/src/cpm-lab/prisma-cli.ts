import { spawnSync } from "node:child_process";
import {
  assertDistinctLabDatabase,
  LabDatabaseTargetError,
} from "./database-target.js";

const action = process.argv[2];
if (action !== "generate" && action !== "migrate") {
  process.stderr.write("usage: prisma-cli.ts generate|migrate\n");
  process.exit(1);
}

let labUrl: string;
try {
  labUrl = assertDistinctLabDatabase({
    LAB_DATABASE_URL: process.env.LAB_DATABASE_URL,
    DATABASE_URL: process.env.DATABASE_URL,
  });
} catch (error) {
  const message =
    error instanceof LabDatabaseTargetError
      ? error.message
      : "Lab database target was rejected.";
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const prismaArgs =
  action === "generate"
    ? ["generate", "--schema", "prisma-lab/schema.prisma"]
    : ["migrate", "deploy", "--schema", "prisma-lab/schema.prisma"];

const child = spawnSync("pnpm", ["exec", "prisma", ...prismaArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    LAB_DATABASE_URL: labUrl,
  },
});

if (child.error) {
  process.stderr.write("The lab Prisma command could not be started.\n");
  process.exit(1);
}

process.exit(child.status ?? 1);
