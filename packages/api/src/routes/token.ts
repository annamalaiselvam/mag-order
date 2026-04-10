import { FastifyInstance } from "fastify";
import twilio from "twilio";
import { config } from "../config.js";

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;

export async function tokenRoutes(app: FastifyInstance) {
  app.get("/api/token", async (_request, reply) => {
    const token = new AccessToken(
      config.twilio.accountSid,
      config.twilio.apiKey,
      config.twilio.apiSecret,
      { identity: "browser-caller", ttl: 3600 }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: config.twilio.twimlAppSid,
      incomingAllow: false,
    });

    token.addGrant(voiceGrant);

    reply.send({ token: token.toJwt() });
  });

  // Expose phone number so UI can show "Call us" option
  app.get("/api/phone", async (_request, reply) => {
    reply.send({ phone: config.twilio.phoneNumber });
  });
}
