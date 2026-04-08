import { EventEmitter } from "events";

export interface CallSession {
  callSid: string;
  streamSid: string | null;
  callerPhone: string;
  status: "ringing" | "in_progress" | "completed" | "failed" | "transferred";
  startedAt: Date;
  audioBuffer: Buffer[];
}

class CallManager extends EventEmitter {
  private sessions = new Map<string, CallSession>();

  createSession(callSid: string, callerPhone: string): CallSession {
    const session: CallSession = {
      callSid,
      streamSid: null,
      callerPhone,
      status: "ringing",
      startedAt: new Date(),
      audioBuffer: [],
    };
    this.sessions.set(callSid, session);
    this.emit("session:created", session);
    return session;
  }

  getSession(callSid: string): CallSession | undefined {
    return this.sessions.get(callSid);
  }

  updateStatus(callSid: string, status: CallSession["status"]): void {
    const session = this.sessions.get(callSid);
    if (session) {
      session.status = status;
      this.emit("session:status", session);
    }
  }

  setStreamSid(callSid: string, streamSid: string): void {
    const session = this.sessions.get(callSid);
    if (session) {
      session.streamSid = streamSid;
    }
  }

  endSession(callSid: string): void {
    const session = this.sessions.get(callSid);
    if (session) {
      session.status = "completed";
      this.emit("session:ended", session);
      this.sessions.delete(callSid);
    }
  }

  getActiveSessions(): CallSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "in_progress"
    );
  }

  getAllSessions(): CallSession[] {
    return Array.from(this.sessions.values());
  }
}

export const callManager = new CallManager();
