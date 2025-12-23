// src/services/TaskMatchingService.js
import EngineerProfile from "../models/EngineerProfile.js";
import User from "../models/User.js";

export async function matchEngineerForTicket(ticket) {
  // Very simple demo: pick any APPROVED engineer with matching trade & country.
  const engineerProfile = await EngineerProfile.findOne({
    primaryTrade: ticket.trade,
    country: { $in: [ticket.country, ticket.country || "United Kingdom"].filter(Boolean) },
    daoStatus: "APPROVED",
  }).populate("userId");

  // fallback: first APPROVED engineer globally
  const profileFallback =
    engineerProfile ||
    (await EngineerProfile.findOne({ daoStatus: "APPROVED" }).populate("userId"));

  if (!profileFallback) {
    return null;
  }

  /** @type {import("../models/User.js").default} */
  const engineerUser = profileFallback.userId || (await User.findOne({ role: "ENGINEER" }));

  return engineerUser;
}
