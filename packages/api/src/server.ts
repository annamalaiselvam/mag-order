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

  // Start server
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Server running on ${config.host}:${config.port}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
