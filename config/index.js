import dotenv from "dotenv";

dotenv.config();

export const config = {
  app: {
    port: process.env.PORT || 3000,
    environment: process.env.NODE_ENV || "development",
  },
  session: {
    secret: process.env.SESSION_SECRET || "bristo-secret-key",
  },
  roblox: {
    clientId: process.env.ROBLOX_CLIENT_ID,
    clientSecret: process.env.ROBLOX_CLIENT_SECRET,
    callbackUrl: process.env.ROBLOX_CALLBACK_URL,
  },
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackUrl: process.env.DISCORD_CALLBACK_URL,
  },
  cache: {
    defaultTTL: parseInt(process.env.CACHE_TTL) || 300,
    maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 1000,
  },
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 300, // Increase from 100 to 300
    authWindowMs: 15 * 60 * 1000,
    authMaxRequests: 50, // Increase from 5 to 50
  },
};
