import { describe, it, expect, beforeEach, vi } from "vitest";
import { callManager } from "../lib/call-manager.js";

describe("CallManager", () => {
  beforeEach(() => {
    // Clear all sessions between tests
    for (const session of callManager.getAllSessions()) {
      callManager.endSession(session.callSid);
    }
    callManager.removeAllListeners();
  });

  describe("session lifecycle", () => {
    it("creates a new call session", () => {
      const session = callManager.createSession("CA_test_1", "+15551234567");

      expect(session.callSid).toBe("CA_test_1");
      expect(session.callerPhone).toBe("+15551234567");
      expect(session.status).toBe("ringing");
      expect(session.streamSid).toBeNull();
      expect(session.audioBuffer).toEqual([]);
      expect(session.startedAt).toBeInstanceOf(Date);
    });

    it("emits session:created event", () => {
      const handler = vi.fn();
      callManager.on("session:created", handler);

      callManager.createSession("CA_test_2", "+15559999999");

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].callSid).toBe("CA_test_2");
    });

    it("retrieves an existing session", () => {
      callManager.createSession("CA_get_test", "+15550001111");
      const session = callManager.getSession("CA_get_test");

      expect(session).toBeDefined();
      expect(session!.callSid).toBe("CA_get_test");
    });

    it("returns undefined for non-existent session", () => {
      expect(callManager.getSession("CA_nonexistent")).toBeUndefined();
    });

    it("updates session status", () => {
      callManager.createSession("CA_status_test", "+15550002222");
      const handler = vi.fn();
      callManager.on("session:status", handler);

      callManager.updateStatus("CA_status_test", "in_progress");

      const session = callManager.getSession("CA_status_test");
      expect(session!.status).toBe("in_progress");
      expect(handler).toHaveBeenCalledOnce();
    });

    it("sets stream SID on session", () => {
      callManager.createSession("CA_stream_test", "+15550003333");
      callManager.setStreamSid("CA_stream_test", "MZ_stream_123");

      const session = callManager.getSession("CA_stream_test");
      expect(session!.streamSid).toBe("MZ_stream_123");
    });

    it("ends a session and emits event", () => {
      callManager.createSession("CA_end_test", "+15550004444");
      const handler = vi.fn();
      callManager.on("session:ended", handler);

      callManager.endSession("CA_end_test");

      expect(callManager.getSession("CA_end_test")).toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].status).toBe("completed");
    });

    it("handles ending a non-existent session gracefully", () => {
      // Should not throw
      callManager.endSession("CA_never_existed");
    });
  });

  describe("active sessions", () => {
    it("returns only in_progress sessions", () => {
      callManager.createSession("CA_active_1", "+15550005555");
      callManager.createSession("CA_active_2", "+15550006666");
      callManager.createSession("CA_active_3", "+15550007777");

      callManager.updateStatus("CA_active_1", "in_progress");
      callManager.updateStatus("CA_active_3", "in_progress");
      // CA_active_2 remains "ringing"

      const active = callManager.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.callSid)).toContain("CA_active_1");
      expect(active.map((s) => s.callSid)).toContain("CA_active_3");
    });

    it("returns all sessions regardless of status", () => {
      callManager.createSession("CA_all_1", "+15550008888");
      callManager.createSession("CA_all_2", "+15550009999");
      callManager.updateStatus("CA_all_1", "in_progress");

      const all = callManager.getAllSessions();
      expect(all).toHaveLength(2);
    });
  });

  describe("audio pipeline events", () => {
    it("emits audio:stream-start event", () => {
      const handler = vi.fn();
      callManager.on("audio:stream-start", handler);

      callManager.emit("audio:stream-start", {
        callSid: "CA_audio_1",
        streamSid: "MZ_audio_1",
        socket: {},
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].callSid).toBe("CA_audio_1");
    });

    it("emits audio:data event with payload", () => {
      const handler = vi.fn();
      callManager.on("audio:data", handler);

      const payload = Buffer.from("test audio").toString("base64");
      callManager.emit("audio:data", {
        callSid: "CA_audio_2",
        payload,
        timestamp: "12345",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].payload).toBe(payload);
    });
  });

  describe("concurrent sessions (multi-caller)", () => {
    it("manages multiple simultaneous call sessions independently", () => {
      callManager.createSession("CA_multi_1", "+15551111111");
      callManager.createSession("CA_multi_2", "+15552222222");
      callManager.createSession("CA_multi_3", "+15553333333");

      callManager.updateStatus("CA_multi_1", "in_progress");
      callManager.setStreamSid("CA_multi_1", "MZ_multi_1");
      callManager.updateStatus("CA_multi_2", "in_progress");
      callManager.endSession("CA_multi_3");

      expect(callManager.getActiveSessions()).toHaveLength(2);
      expect(callManager.getSession("CA_multi_3")).toBeUndefined();
      expect(callManager.getSession("CA_multi_1")!.streamSid).toBe("MZ_multi_1");
      expect(callManager.getSession("CA_multi_2")!.streamSid).toBeNull();
    });
  });
});
