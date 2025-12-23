// src/services/RevolutGateway.js
import { randomUUID } from "crypto";

export class RevolutGateway {
  static async createEscrow({ userId, amountGBP, reference }) {
    // Demo only: pretend Revolut gave us an escrow pocket.
    return {
      id: `esc_${randomUUID()}`,
      userId,
      amountGBP,
      reference,
      status: "HELD",
    };
  }

  static async createVirtualCard({ engineerId, currency, amount, reference }) {
    const id = `card_${randomUUID()}`;
    return {
      id,
      engineerId,
      currency,
      amount,
      reference,
      pan: "5274 19•• •••• 4821",
      last4: "4821",
      cvv: "983",
      validThru: "07/26",
    };
  }

  static async refundEscrow({ escrowId, reason }) {
    return { escrowId, status: "REFUND_REQUESTED", reason };
  }
}

export default RevolutGateway;
