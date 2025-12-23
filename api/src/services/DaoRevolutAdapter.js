// src/services/DaoRevolutAdapter.js
// DEMO VERSION — Lightweight escrow → payout → refund simulation
// Keeps frontend + role dashboard working without real Revolut/Treasury/Chain.

import { logger } from "../config/logger.js";

export class DaoRevolutAdapter {
  /**
   * Create escrow when a ticket is raised (demo).
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.workflowId
   * @param {number} params.amountGBP
   * @param {number} [params.feePct=10]
   */
  static async createEscrow({ userId, workflowId, amountGBP, feePct = 10 }) {
    if (!userId || !workflowId) {
      throw new Error("missing_user_or_workflow");
    }
    if (!Number.isFinite(amountGBP) || amountGBP <= 0) {
      throw new Error("invalid_amount");
    }

    const escrow = {
      id: `esc_demo_${workflowId}`,
      userId,
      workflowId,
      amountGBP,
      feePct,
      status: "ESCROW_HELD_DEMO",
      createdAt: new Date().toISOString()
    };

    logger.info("DaoRevolutAdapter.createEscrow (demo)", escrow);

    // In full system: Payment.create(), Ledger.add(), recordExecLog()
    return escrow;
  }

  /**
   * Approve & pay engineer from escrow (demo).
   *
   * @param {Object} params
   * @param {string} params.workflowId
   * @param {string} params.engineerId
   * @param {number} params.amountGBP
   */
  static async approveAndPay({ workflowId, engineerId, amountGBP }) {
    if (!workflowId || !engineerId) {
      throw new Error("missing_workflow_or_engineer");
    }
    if (!Number.isFinite(amountGBP) || amountGBP <= 0) {
      throw new Error("invalid_amount");
    }

    const feePct = 10;
    const feeGBP = Math.round(amountGBP * (feePct / 100));
    const netGBP = amountGBP - feeGBP;

    // Demo virtual card object — used to populate the dashboard card UI.
    const card = {
      id: `card_demo_${workflowId}`,
      workflowId,
      engineerId,
      amount: netGBP,
      currency: "GBP",
      provider: "Revolut Business (demo)",
      pan: "5274 19•• •••• 4821",
      last4: "4821",
      validThru: "07/26",
      cvv: "983"
    };

    logger.info("DaoRevolutAdapter.approveAndPay (demo)", {
      workflowId,
      engineerId,
      amountGBP,
      feeGBP,
      netGBP,
      card
    });

    return { card, feeGBP, netGBP };
  }

  /**
   * Refund escrow (demo).
   *
   * @param {Object} params
   * @param {string} params.workflowId
   * @param {string} [params.reason]
   */
  static async refund({ workflowId, reason }) {
    if (!workflowId) {
      throw new Error("missing_workflow");
    }

    const res = {
      workflowId,
      reason: reason || "demo_refund",
      amountGBP: 200,
      status: "REFUND_REQUESTED_DEMO",
      refundedAt: new Date().toISOString()
    };

    logger.info("DaoRevolutAdapter.refund (demo)", res);

    return res;
  }
}

export default DaoRevolutAdapter;
