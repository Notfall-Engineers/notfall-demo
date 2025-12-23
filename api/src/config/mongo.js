// api/src/config/mongo.js
import mongoose from "mongoose";
import { MONGODB_URI } from "./env.js";

let connectionPromise = null;

export async function connectMongo() {
  if (mongoose.connection?.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(MONGODB_URI, {
      autoIndex: true,
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
  }

  await connectionPromise;
  return mongoose.connection;
}
