import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";
import { db } from "../db/index.js";
import { callManager } from "../lib/call-manager.js";

const mockDb = db as any;

describe("Error Scenarios", () => {
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
    callManager.removeAllListeners();
  });

  describe("Caller hang-up mid-order", () => {
    it("cleans up session when call completes mid-conversation", async () => {
      const callSid = "CA_hangup_1";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15551112222`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      callManager.updateStatus(callSid, "in_progress");

      let activeRes = await app.inject({ method: "GET", url: "/api/calls/active" });
      expect(activeRes.json()).toHaveLength(1);

      // Caller hangs up
      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(callManager.getSession(callSid)).toBeUndefined();
      activeRes = await app.inject({ method: "GET", url: "/api/calls/active" });
      expect(activeRes.json()).toEqual([]);
    });

    it("handles failed call status correctly", async () => {
      const callSid = "CA_failed_call";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15553334444`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=failed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(callManager.getSession(callSid)).toBeUndefined();
    });
  });

  describe("WebSocket media stream events (simulated)", () => {
    it("handles media stream stop — session cleanup", () => {
      const callSid = "CA_ws_stop";
      callManager.createSession(callSid, "+15554445555");
      callManager.updateStatus(callSid, "in_progress");
      callManager.endSession(callSid);
      expect(callManager.getSession(callSid)).toBeUndefined();
    });

    it("handles WebSocket close — session cleanup", () => {
      const callSid = "CA_ws_close";
      callManager.createSession(callSid, "+15555556666");
      callManager.updateStatus(callSid, "in_progress");
      callManager.endSession(callSid);
      expect(callManager.getSession(callSid)).toBeUndefined();
    });

    it("handles duplicate endSession calls gracefully", () => {
      const callSid = "CA_double_end";
      callManager.createSession(callSid, "+15556667777");
      callManager.endSession(callSid);
      callManager.endSession(callSid); // should not throw
      expect(callManager.getSession(callSid)).toBeUndefined();
    });
  });

  describe("Order status workflow", () => {
    it("order transitions through full lifecycle", async () => {
      const statuses = ["pending", "confirmed", "preparing", "ready", "served"];

      for (let i = 1; i < statuses.length; i++) {
        const to = statuses[i];
        mockDb._pushResult([{ id: "ord-lifecycle", status: to, total: "24.99" }]);

        const res = await app.inject({
          method: "PATCH",
          url: "/api/orders/ord-lifecycle",
          payload: { status: to },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe(to);
      }
    });

    it("order can be cancelled at any point", async () => {
      mockDb._pushResult([{ id: "ord-cancel", status: "cancelled", total: "24.99" }]);

      const res = await app.inject({
        method: "PATCH",
        url: "/api/orders/ord-cancel",
        payload: { status: "cancelled" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("cancelled");
    });
  });

  describe("Rapid successive calls from same number", () => {
    it("handles rapid re-calls from same phone number", async () => {
      const phone = "+15559990001";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=CA_rapid_1&From=${encodeURIComponent(phone)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: "CallSid=CA_rapid_1&CallStatus=completed",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=CA_rapid_2&From=${encodeURIComponent(phone)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const session = callManager.getSession("CA_rapid_2");
      expect(session).toBeDefined();
      expect(session!.callerPhone).toBe(phone);
      expect(callManager.getSession("CA_rapid_1")).toBeUndefined();
    });
  });
});
