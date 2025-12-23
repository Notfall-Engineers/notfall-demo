// src/services/MatchingService.js
// Matching evolution: rules now, ML later (cleanly).
// Returns: { ranked, modelVersion, explain } where explain is investor-friendly.

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export class MatchingService {
  constructor({ mode = "rules", modelClient = null, logger = console } = {}) {
    this.mode = mode; // "rules" | "ml"
    this.modelClient = modelClient; // later: call Vertex/endpoint/etc.
    this.logger = logger;
    this.modelVersion = mode === "ml" ? "ml:v0" : "rules:v1";
  }

  // Rule-based scoring (deterministic + explainable)
  scoreRuleBased({ ticket, engineer }) {
    const reasons = [];

    // Hard gates
    if (ticket.requiredCertified && !engineer.isCertified) {
      return { score: -999, reasons: ["Rejected: not DAO-certified"] };
    }
    if (ticket.requiredInsurance && !engineer.hasInsurance) {
      return { score: -999, reasons: ["Rejected: insurance missing"] };
    }
    if (engineer.available === false) {
      return { score: -999, reasons: ["Rejected: not available"] };
    }

    // Score components (simple, tune later)
    const eta = Number(engineer.etaMinutes ?? 60);
    const reliability = Number(engineer.reliability ?? 0.85); // 0..1
    const acceptanceRate = Number(engineer.acceptanceRate ?? 0.7); // 0..1
    const rate = Number(engineer.hourlyRateGBP ?? 75);

    // Prefer lower ETA, higher reliability/acceptance; mild cost pressure
    const etaScore = clamp(1 - eta / 90, 0, 1) * 0.42;
    const relScore = clamp(reliability, 0, 1) * 0.32;
    const accScore = clamp(acceptanceRate, 0, 1) * 0.18;

    // Encourage “fairness” for newer engineers (avoid starvation)
    const fairness = clamp(1 - (engineer.offersToday ?? 0) / 8, 0, 1) * 0.06;

    // Cost component (do not over-optimise cost for emergency)
    const costScore = clamp(1 - (rate - 45) / (120 - 45), 0, 1) * 0.02;

    const score = etaScore + relScore + accScore + fairness + costScore;

    reasons.push(`ETA ${eta}m → +${etaScore.toFixed(3)}`);
    reasons.push(`Reliability ${(reliability * 100).toFixed(0)}% → +${relScore.toFixed(3)}`);
    reasons.push(`Acceptance ${(acceptanceRate * 100).toFixed(0)}% → +${accScore.toFixed(3)}`);
    reasons.push(`Fairness offersToday=${engineer.offersToday ?? 0} → +${fairness.toFixed(3)}`);
    reasons.push(`Rate £${rate}/h → +${costScore.toFixed(3)}`);

    return { score, reasons, etaMinutes: eta };
  }

  async rankEngineers({ ticket, engineers = [] }) {
    if (this.mode === "ml" && this.modelClient) {
      // Phase 1+ placeholder:
      // return this.modelClient.rank({ ticket, engineers })
      // Must return same shape as below.
    }

    const scored = engineers
      .map((eng) => {
        const out = this.scoreRuleBased({ ticket, engineer: eng });
        return { engineer: eng, score: out.score, reasons: out.reasons, etaMinutes: out.etaMinutes };
      })
      .filter((x) => x.score > -100);

    scored.sort((a, b) => b.score - a.score);

    const ranked = scored.map((x, idx) => ({
      engineerId: x.engineer.engineerId,
      name: x.engineer.name,
      trade: x.engineer.trade,
      hourlyRateGBP: x.engineer.hourlyRateGBP,
      etaMinutes: x.etaMinutes ?? x.engineer.etaMinutes ?? null,
      matchScore: Number(x.score.toFixed(4)),
      rank: idx + 1,
    }));

    const explain = {
      model: this.modelVersion,
      ticket: {
        trade: ticket.trade,
        severity: ticket.severity,
        site: ticket.siteCode,
      },
      topReasons: scored.slice(0, 3).map((x) => ({
        engineerId: x.engineer.engineerId,
        reasons: x.reasons.slice(0, 4),
      })),
    };

    return { ranked, modelVersion: this.modelVersion, explain };
  }
}
