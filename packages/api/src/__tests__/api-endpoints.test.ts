import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp, SAMPLE_MENU_ITEMS, SAMPLE_ORDER, SAMPLE_ORDER_ITEMS, SAMPLE_CALL_RECORD } from "./helpers.js";
import { db } from "../db/index.js";
import { callManager } from "../lib/call-manager.js";

const mockDb = db as any;

describe("API Endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockDb._clearResults();
    for (const session of callManager.getAllSessions()) {
      callManager.endSession(session.callSid);
    }
  });

  describe("GET /health", () => {
    it("returns ok status", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("Menu API", () => {
    it("GET /api/menu returns available menu items", async () => {
      mockDb._pushResult(SAMPLE_MENU_ITEMS);

      const res = await app.inject({ method: "GET", url: "/api/menu" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(3);
      expect(body[0].name).toBe("Spring Rolls");
      expect(body[1].name).toBe("Grilled Salmon");
    });

    it("GET /api/menu/:id returns a single menu item", async () => {
      mockDb._pushResult([SAMPLE_MENU_ITEMS[0]]);

      const res = await app.inject({
        method: "GET",
        url: "/api/menu/aaa-111",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe("Spring Rolls");
      expect(body.price).toBe("8.99");
    });

    it("GET /api/menu/:id returns 404 for unknown item", async () => {
      mockDb._pushResult([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/menu/nonexistent-id",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("Orders API", () => {
    it("GET /api/orders returns order list", async () => {
      mockDb._pushResult([SAMPLE_ORDER]);

      const res = await app.inject({ method: "GET", url: "/api/orders" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].status).toBe("pending");
    });

    it("GET /api/orders/:id returns order with items", async () => {
      // First query: get order
      mockDb._pushResult([SAMPLE_ORDER]);
      // Second query: get order items
      mockDb._pushResult(SAMPLE_ORDER_ITEMS);

      const res = await app.inject({
        method: "GET",
        url: "/api/orders/ord-001",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("ord-001");
      expect(body.items).toHaveLength(2);
      expect(body.items[0].quantity).toBe(1);
    });

    it("GET /api/orders/:id returns 404 for unknown order", async () => {
      mockDb._pushResult([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/orders/nonexistent",
      });

      expect(res.statusCode).toBe(404);
    });

    it("PATCH /api/orders/:id updates order status", async () => {
      const updatedOrder = { ...SAMPLE_ORDER, status: "confirmed" };
      mockDb._pushResult([updatedOrder]);

      const res = await app.inject({
        method: "PATCH",
        url: "/api/orders/ord-001",
        payload: { status: "confirmed" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("confirmed");
    });

    it("PATCH /api/orders/:id returns 404 for unknown order", async () => {
      mockDb._pushResult([]);

      const res = await app.inject({
        method: "PATCH",
        url: "/api/orders/nonexistent",
        payload: { status: "confirmed" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("Calls API", () => {
    it("GET /api/calls/active returns active in-memory sessions", async () => {
      callManager.createSession("CA_active_test", "+15551112222");
      callManager.updateStatus("CA_active_test", "in_progress");

      const res = await app.inject({
        method: "GET",
        url: "/api/calls/active",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].callSid).toBe("CA_active_test");
      expect(body[0].status).toBe("in_progress");
    });

    it("GET /api/calls/active returns empty when no active calls", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/calls/active",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("GET /api/calls returns call history from database", async () => {
      mockDb._pushResult([SAMPLE_CALL_RECORD]);

      const res = await app.inject({ method: "GET", url: "/api/calls" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].callSid).toBe("CA_test_sid_001");
    });
  });
});
