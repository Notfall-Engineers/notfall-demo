// api/src/services/storageService.js
import { Storage } from "@google-cloud/storage";
import {
  FIRESTORE_PROJECT_ID,
  GOOGLE_APPLICATION_CREDENTIALS
} from "../config/env.js";

const storage = new Storage({
  projectId: FIRESTORE_PROJECT_ID,
  keyFilename: GOOGLE_APPLICATION_CREDENTIALS
});

const BUCKET_NAME =
  process.env.GCS_BUCKET_NAME || "notfall-demo-waitlist-exports";

export async function uploadJsonToBucket(filename, data) {
  const bucket = storage.bucket(BUCKET_NAME);

  const file = bucket.file(filename);
  const jsonBuffer = Buffer.from(JSON.stringify(data, null, 2), "utf8");

  await file.save(jsonBuffer, {
    contentType: "application/json",
    resumable: false
  });

  return `gs://${BUCKET_NAME}/${filename}`;
}
