import Fastify, { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import { healthRoutes } from "../routes/health.js";
import { twilioRoutes } from "../routes/twilio.js";
import { menuRoutes } from "../routes/menu.js";
import { orderRoutes } from "../routes/orders.js";
import { callRoutes } from "../routes/calls.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyFormbody);
  await app.register(fastifyWebsocket);

  await app.register(healthRoutes);
  await app.register(twilioRoutes);
  await app.register(menuRoutes);
  await app.register(orderRoutes);
  await app.register(callRoutes);

  await app.ready();
  return app;
}

export const SAMPLE_MENU_ITEMS = [
  {
    id: "aaa-111",
    name: "Spring Rolls",
    description: "Crispy vegetable spring rolls",
    price: "8.99",
    category: "appetizers",
    available: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "bbb-222",
    name: "Grilled Salmon",
    description: "Atlantic salmon with lemon butter",
    price: "24.99",
    category: "mains",
    available: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "ccc-333",
    name: "Tiramisu",
    description: "Classic Italian dessert",
    price: "10.99",
    category: "desserts",
    available: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

export const SAMPLE_ORDER = {
  id: "ord-001",
  status: "pending",
  total: "33.98",
  notes: "No nuts please",
  callerPhone: "+15559876543",
  callSid: "CA_test_sid_001",
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const SAMPLE_ORDER_ITEMS = [
  {
    id: "oi-001",
    orderId: "ord-001",
    menuItemId: "aaa-111",
    quantity: 1,
    unitPrice: "8.99",
  },
  {
    id: "oi-002",
    orderId: "ord-001",
    menuItemId: "bbb-222",
    quantity: 1,
    unitPrice: "24.99",
  },
];

export const SAMPLE_CALL_RECORD = {
  id: "call-001",
  callSid: "CA_test_sid_001",
  callerPhone: "+15559876543",
  status: "completed",
  orderId: "ord-001",
  startedAt: new Date(),
  endedAt: new Date(),
};
