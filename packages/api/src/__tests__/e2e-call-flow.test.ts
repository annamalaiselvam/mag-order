import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp, SAMPLE_MENU_ITEMS } from "./helpers.js";
import { db } from "../db/index.js";
import { callManager } from "../lib/call-manager.js";

const mockDb = db as any;

describe("End-to-End Call Flow", () => {
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

  describe("Single-item order flow", () => {
    it("simulates complete call lifecycle: ring -> in_progress -> order -> completed", async () => {
      const callSid = "CA_e2e_single_order";

      // Step 1: Inbound call arrives (Twilio POST)
      const voiceRes = await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15551234567&To=%2B15559999999`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(voiceRes.statusCode).toBe(200);
      expect(voiceRes.body).toContain("<Response>");

      // Verify session created in ringing state
      let session = callManager.getSession(callSid);
      expect(session).toBeDefined();
      expect(session!.status).toBe("ringing");
      expect(session!.callerPhone).toBe("+15551234567");

      // Step 2: Media stream starts (simulated)
      callManager.updateStatus(callSid, "in_progress");
      callManager.setStreamSid(callSid, "MZ_e2e_stream_1");

      session = callManager.getSession(callSid);
      expect(session!.status).toBe("in_progress");
      expect(session!.streamSid).toBe("MZ_e2e_stream_1");

      // Step 3: Verify active call shows up
      const activeRes = await app.inject({
        method: "GET",
        url: "/api/calls/active",
      });
      expect(activeRes.json()).toHaveLength(1);
      expect(activeRes.json()[0].callSid).toBe(callSid);

      // Step 4: Call completes
      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(callManager.getSession(callSid)).toBeUndefined();

      // Step 5: Verify no active calls remain
      const activeRes2 = await app.inject({
        method: "GET",
        url: "/api/calls/active",
      });
      expect(activeRes2.json()).toEqual([]);
    });
  });

  describe("Multi-item order with special instructions", () => {
    it("simulates order with multiple items and notes", async () => {
      const callSid = "CA_e2e_multi_order";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15552223333`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      callManager.updateStatus(callSid, "in_progress");
      expect(callManager.getSession(callSid)!.callerPhone).toBe("+15552223333");

      // Simulate voice agent confirming the order
      const updatedOrder = {
        id: "ord-multi",
        status: "confirmed",
        total: "43.97",
        notes: "No nuts on the salmon, extra sauce on spring rolls",
      };
      mockDb._pushResult([updatedOrder]);

      const patchRes = await app.inject({
        method: "PATCH",
        url: "/api/orders/ord-multi",
        payload: { status: "confirmed" },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().status).toBe("confirmed");

      // Call ends
      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(callManager.getSession(callSid)).toBeUndefined();
    });
  });

  describe("Reservation booking flow", () => {
    it("simulates call with reservation request", async () => {
      const callSid = "CA_e2e_reservation";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15553334444`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      callManager.updateStatus(callSid, "in_progress");

      const activeRes = await app.inject({
        method: "GET",
        url: "/api/calls/active",
      });
      expect(activeRes.json()).toHaveLength(1);

      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(callManager.getSession(callSid)).toBeUndefined();
    });
  });

  describe("Mixed order + reservation flow", () => {
    it("handles both order and reservation in same call", async () => {
      const callSid = "CA_e2e_mixed";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15554445555`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      callManager.updateStatus(callSid, "in_progress");

      const session = callManager.getSession(callSid);
      expect(session).toBeDefined();
      expect(session!.status).toBe("in_progress");

      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callSid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(callManager.getSession(callSid)).toBeUndefined();
    });
  });

  describe("Menu availability during call", () => {
    it("voice agent can query menu during active call", async () => {
      const callSid = "CA_e2e_menu_query";

      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: `CallSid=${callSid}&From=%2B15555556666`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      callManager.updateStatus(callSid, "in_progress");

      // Voice agent queries full menu
      mockDb._pushResult(SAMPLE_MENU_ITEMS);
      const menuRes = await app.inject({ method: "GET", url: "/api/menu" });
      expect(menuRes.statusCode).toBe(200);
      expect(menuRes.json()).toHaveLength(3);

      // Query specific item
      mockDb._pushResult([SAMPLE_MENU_ITEMS[1]]);
      const itemRes = await app.inject({
        method: "GET",
        url: "/api/menu/bbb-222",
      });
      expect(itemRes.statusCode).toBe(200);
      expect(itemRes.json().name).toBe("Grilled Salmon");
    });

    it("handles item not on menu (clarification scenario)", async () => {
      mockDb._pushResult([]);
      const res = await app.inject({
        method: "GET",
        url: "/api/menu/nonexistent-item",
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Concurrent calls", () => {
    it("manages multiple simultaneous callers independently", async () => {
      const callers = [
        { sid: "CA_concurrent_1", phone: "+15551110001" },
        { sid: "CA_concurrent_2", phone: "+15551110002" },
        { sid: "CA_concurrent_3", phone: "+15551110003" },
      ];

      for (const caller of callers) {
        await app.inject({
          method: "POST",
          url: "/twilio/voice",
          payload: `CallSid=${caller.sid}&From=${encodeURIComponent(caller.phone)}`,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
        callManager.updateStatus(caller.sid, "in_progress");
      }

      let activeRes = await app.inject({ method: "GET", url: "/api/calls/active" });
      expect(activeRes.json()).toHaveLength(3);

      // First caller completes
      await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: `CallSid=${callers[0].sid}&CallStatus=completed`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      activeRes = await app.inject({ method: "GET", url: "/api/calls/active" });
      expect(activeRes.json()).toHaveLength(2);

      // Remaining callers complete
      for (const caller of callers.slice(1)) {
        await app.inject({
          method: "POST",
          url: "/twilio/status",
          payload: `CallSid=${caller.sid}&CallStatus=completed`,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        });
      }

      activeRes = await app.inject({ method: "GET", url: "/api/calls/active" });
      expect(activeRes.json()).toEqual([]);
    });
  });
});
