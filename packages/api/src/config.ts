import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load from repo root .env
dotenvConfig({ path: resolve(__dirname, "../../../.env"), override: true });

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL!,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
    apiKey: process.env.TWILIO_API_KEY!,
    apiSecret: process.env.TWILIO_API_SECRET!,
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID!,
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY!,
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
};
