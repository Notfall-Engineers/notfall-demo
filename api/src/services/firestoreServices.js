// api/src/services/firestoreServices.js (mongo-only version)
import { connectMongo } from "../config/mongo.js";
import { WaitlistEntry } from "../models/waitlistModel.js";

export async function createWaitlistEntry(data) {
  await connectMongo();

  const payload = {
    fullName: data.fullName,
    workEmail: data.workEmail.toLowerCase(),
    persona: data.persona,
    region: data.region,
    source: data.source || "landing"
  };

  const entry = await WaitlistEntry.findOneAndUpdate(
    { workEmail: payload.workEmail },
    payload,
    { upsert: true, new: true }
  );

  return { id: entry._id };
}
