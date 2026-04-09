import "dotenv/config";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { twilioRoutes } from "./routes/twilio.js";
import { menuRoutes } from "./routes/menu.js";
import { orderRoutes } from "./routes/orders.js";
import { callRoutes } from "./routes/calls.js";
import { tokenRoutes } from "./routes/token.js";
import { warmMenuCache } from "./services/voice-agent.js";
import fastifyStatic from "@fastify/static";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: config.nodeEnv === "production" ? "info" : "debug",
  },
});

async function start() {
  // Register plugins
  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyFormbody);
  await app.register(fastifyWebsocket);

  // Register routes
  await app.register(healthRoutes);
  await app.register(twilioRoutes);
  await app.register(menuRoutes);
  await app.register(orderRoutes);
  await app.register(callRoutes);
  await app.register(tokenRoutes);

  // Serve web frontend (SPA)
  const webDist = resolve(__dirname, "../../web/dist");
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  // SPA fallback — only for non-asset, non-api routes
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile("index.html", webDist);
  });

  // Start server
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server running on ${config.host}:${config.port}`);

  // Pre-warm menu cache so first caller doesn't wait
  warmMenuCache().catch(() => {});
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
