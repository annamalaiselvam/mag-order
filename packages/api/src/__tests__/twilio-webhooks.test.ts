import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "./helpers.js";
import { db } from "../db/index.js";
import { callManager } from "../lib/call-manager.js";

const mockDb = db as any;

describe("Twilio Webhook Endpoints", () => {
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

  describe("POST /twilio/voice (inbound call)", () => {
    it("returns TwiML response with greeting and media stream", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: "CallSid=CA_inbound_1&From=%2B15559876543&To=%2B15551234567",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/xml");

      const xml = res.body;
      expect(xml).toContain("<?xml");
      expect(xml).toContain("<Response>");
      expect(xml).toContain("<Say");
      expect(xml).toContain("Welcome to Mag Order");
      expect(xml).toContain("<Connect>");
      expect(xml).toContain("<Stream");
      expect(xml).toContain("media-stream");
      expect(xml).toContain('value="CA_inbound_1"');
    });

    it("creates a call session in CallManager", async () => {
      await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: "CallSid=CA_session_test&From=%2B15550001111",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      const session = callManager.getSession("CA_session_test");
      expect(session).toBeDefined();
      expect(session!.callerPhone).toBe("+15550001111");
      expect(session!.status).toBe("ringing");
    });

    it("handles missing From field gracefully", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/twilio/voice",
        payload: "CallSid=CA_no_from",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(res.statusCode).toBe(200);
      const session = callManager.getSession("CA_no_from");
      expect(session!.callerPhone).toBe("unknown");
    });
  });

  describe("POST /twilio/status (call status callback)", () => {
    it("ends session on completed status", async () => {
      callManager.createSession("CA_complete_1", "+15550004444");

      const res = await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: "CallSid=CA_complete_1&CallStatus=completed",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(callManager.getSession("CA_complete_1")).toBeUndefined();
    });

    it("ends session on failed status", async () => {
      callManager.createSession("CA_fail_1", "+15550005555");

      const res = await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: "CallSid=CA_fail_1&CallStatus=failed",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(res.statusCode).toBe(200);
      expect(callManager.getSession("CA_fail_1")).toBeUndefined();
    });

    it("does not end session for in-progress status", async () => {
      callManager.createSession("CA_inprog_1", "+15550006666");

      const res = await app.inject({
        method: "POST",
        url: "/twilio/status",
        payload: "CallSid=CA_inprog_1&CallStatus=in-progress",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });

      expect(res.statusCode).toBe(200);
      expect(callManager.getSession("CA_inprog_1")).toBeDefined();
    });
  });
});
