import { FastifyInstance } from "fastify";
import { callManager } from "../lib/call-manager.js";
import { db } from "../db/index.js";
import { calls } from "../db/schema.js";
import { desc } from "drizzle-orm";

export async function callRoutes(app: FastifyInstance) {
  // Active call sessions (in-memory)
  app.get("/api/calls/active", async () => {
    return callManager.getActiveSessions().map((s) => ({
      callSid: s.callSid,
      callerPhone: s.callerPhone,
      status: s.status,
      startedAt: s.startedAt,
    }));
  });

  // Call history (from database)
  app.get("/api/calls", async () => {
    return db.select().from(calls).orderBy(desc(calls.startedAt)).limit(50);
  });
}
