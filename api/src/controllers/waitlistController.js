import { createWaitlistEntry } from "../services/firestoreServices.js";

export async function submitWaitlist(req, res) {
  try {
    const {
      fullName,
      workEmail,
      persona,
      region,
      interests = [],
      tenOutOfTen = "",
      referrer = ""
    } = req.body;

    const result = await createWaitlistEntry({
      fullName,
      workEmail,
      persona,
      region,
      interests,
      tenOutOfTen,
      referrer,
      source: "landing"
    });

    return res.json({
      success: true,
      firestore: false,
      mongo: true,
      id: result.id
    });
  } catch (err) {
    console.error("Waitlist submission error:", err);
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}
