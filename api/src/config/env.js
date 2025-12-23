// api/src/config/env.js
import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 5007;

export const WAITLIST_COLLECTION =
  process.env.WAITLIST_COLLECTION || "dao_waitlist_v1";

// CORS allowed origins (string → array)
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost",
      "https://notfallengineers.co.uk",
      "https://www.notfallengineers.co.uk",
      "https://notfallengineers.com",
      "https://www.notfallengineers.com",
    ];

export const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || "";
export const GOOGLE_APPLICATION_CREDENTIALS =
  process.env.GOOGLE_APPLICATION_CREDENTIALS || "";

export const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/notfall_demo";

export const MONGODB_DB_NAME =
  process.env.MONGODB_DB_NAME || "notfall_demo";

// JWT secret for authMiddleware.js
export const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

// DSS pseudonymiser salt
export const PSEUDONYMISER_SALT =
  process.env.PSEUDONYMISER_SALT || "change-me";
