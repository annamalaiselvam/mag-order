import { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { callManager } from "../lib/call-manager.js";
import { db } from "../db/index.js";
import { calls } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function twilioRoutes(app: FastifyInstance) {
  // TwiML webhook: handles inbound calls from Twilio
  app.post("/twilio/voice", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const callSid = body.CallSid;
    const callerPhone = body.From || "unknown";

    app.log.info({ callSid, callerPhone }, "Inbound call received");

    // Create call session
    callManager.createSession(callSid, callerPhone);

    // Store call in database
    try {
      await db.insert(calls).values({
        callSid,
        callerPhone,
        status: "ringing",
      });
    } catch (err) {
      app.log.error({ err, callSid }, "Failed to store call record");
    }

    // Respond with TwiML to connect to WebSocket media stream
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Welcome to Mag Order. I'll help you place your order. Please go ahead and tell me what you'd like.</Say>
  <Connect>
    <Stream url="wss://${request.hostname}/twilio/media-stream">
      <Parameter name="callSid" value="${callSid}" />
    </Stream>
  </Connect>
</Response>`;

    reply.type("text/xml").send(twiml);
  });

  // Call status callback from Twilio
  app.post("/twilio/status", async (request, reply) => {
    const body = request.body as Record<string, string>;
    const callSid = body.CallSid;
    const callStatus = body.CallStatus;

    app.log.info({ callSid, callStatus }, "Call status update");

    if (callStatus === "completed" || callStatus === "failed") {
      callManager.endSession(callSid);
      try {
        await db
          .update(calls)
          .set({
            status: callStatus === "completed" ? "completed" : "failed",
            endedAt: new Date(),
          })
          .where(eq(calls.callSid, callSid));
      } catch (err) {
        app.log.error({ err, callSid }, "Failed to update call status");
      }
    }

    reply.send({ ok: true });
  });

  // WebSocket endpoint for Twilio Media Streams
  app.get(
    "/twilio/media-stream",
    { websocket: true },
    (socket, request) => {
      app.log.info("Media stream WebSocket connected");

      let callSid: string | null = null;

      socket.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.event) {
            case "connected":
              app.log.info("Twilio media stream connected");
              break;

            case "start": {
              callSid = msg.start?.customParameters?.callSid || null;
              const streamSid = msg.start?.streamSid;
              app.log.info({ callSid, streamSid }, "Media stream started");

              if (callSid) {
                callManager.updateStatus(callSid, "in_progress");
                if (streamSid) {
                  callManager.setStreamSid(callSid, streamSid);
                }
              }

              // Emit event for voice agent pipeline to pick up
              callManager.emit("audio:stream-start", {
                callSid,
                streamSid,
                socket,
              });
              break;
            }

            case "media": {
              // Forward audio payload to voice agent pipeline
              const audioPayload = msg.media?.payload; // base64-encoded mulaw audio
              if (callSid && audioPayload) {
                callManager.emit("audio:data", {
                  callSid,
                  payload: audioPayload,
                  timestamp: msg.media?.timestamp,
                });
              }
              break;
            }

            case "mark":
              app.log.debug({ callSid, mark: msg.mark }, "Mark event");
              break;

            case "stop":
              app.log.info({ callSid }, "Media stream stopped");
              if (callSid) {
                callManager.endSession(callSid);
              }
              break;
          }
        } catch (err) {
          app.log.error({ err }, "Error processing media stream message");
        }
      });

      socket.on("close", () => {
        app.log.info({ callSid }, "Media stream WebSocket closed");
        if (callSid) {
          callManager.endSession(callSid);
        }
      });

      socket.on("error", (err: Error) => {
        app.log.error({ err, callSid }, "Media stream WebSocket error");
      });
    }
  );
}
