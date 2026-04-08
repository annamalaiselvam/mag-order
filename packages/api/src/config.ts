import "dotenv/config";

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  host: process.env.HOST || "0.0.0.0",
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL!,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    authToken: process.env.TWILIO_AUTH_TOKEN!,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER!,
  },
  anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY!,
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
};
