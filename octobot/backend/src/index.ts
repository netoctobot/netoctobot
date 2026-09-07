import Fastify from "fastify";
import { loadEnv } from "./config/env.js";

const env = loadEnv();
const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

await app.listen({ port: env.PORT, host: "0.0.0.0" });
