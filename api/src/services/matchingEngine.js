// api/src/services/matchingEngine.js
// Production-grade deterministic matching engine
// UK English: designed for explainability, auditability, and repeatability

/**
 * Engineer shape expected:
 * {
 *   engineerId,
 *   trades: ["HVAC", "Electrical"],
 *   city,
 *   availability: "AVAILABLE" | "BUSY",
 *   etaMinutes,
 *   hourlyRate,
 *   daoStatus: "CERTIFIED" | "PENDING" | "REVOKED",
 *   reputationScore: 0–100,
 *   activeTasks
 * }
 */

export function matchEngineers({
  ticket,
  engineers,
  now = Date.now(),
}) {
  const reasons = {};
  const scored = [];

  for (const eng of engineers) {
    let score = 0;
    const why = [];

    // 1. Trade compatibility (hard gate)
    if (!eng.trades?.includes(ticket.trade)) {
      reasons[eng.engineerId] = ["Trade mismatch"];
      continue;
    }
    score += 40;
    why.push("Trade match");

    // 2. DAO certification (hard gate)
    if (eng.daoStatus !== "CERTIFIED") {
      reasons[eng.engineerId] = ["DAO not certified"];
      continue;
    }
    score += 25;
    why.push("DAO certified");

    // 3. Availability
    if (eng.availability === "AVAILABLE") {
      score += 15;
      why.push("Available now");
    } else {
      score -= 20;
      why.push("Currently busy");
    }

    // 4. ETA (lower is better)
    if (eng.etaMinutes <= 30) {
      score += 10;
      why.push("ETA under 30 mins");
    } else if (eng.etaMinutes <= 60) {
      score += 5;
      why.push("ETA under 60 mins");
    } else {
      score -= 10;
      why.push("High ETA");
    }

    // 5. Reputation (normalised)
    const repBoost = Math.round((eng.reputationScore || 50) / 10);
    score += repBoost;
    why.push(`Reputation +${repBoost}`);

    // 6. Load balancing
    if ((eng.activeTasks || 0) === 0) {
      score += 5;
      why.push("No active tasks");
    }

    scored.push({
      engineerId: eng.engineerId,
      score,
      reasons: why,
    });
  }

  // Deterministic sort
  scored.sort((a, b) => b.score - a.score);

  return {
    ranked: scored.slice(0, 5), // top 5 engineers
    reasons,
  };
}
