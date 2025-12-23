// services/PaymentOrchestrator.js
import { RevolutGateway, wireRevolutHooks, money } from "./RevolutGateway.js";
import PaymentService from "./PaymentService.js";
import * as widgetBus from "../realtime/widgetBus.js";

const DEFAULT_CAPS = { per_tx_gbp: 2000_00, daily_gbp: 5000_00, weekly_gbp: 20000_00 };

export class PaymentOrchestrator {
  constructor({ audit, chainLog, caps, provider, signer, db } = {}) {
    this.audit = audit ?? (() => {});
    this.chainLog = chainLog ?? (async () => {});
    this.caps = { ...DEFAULT_CAPS, ...(caps || {}) };
    this.provider = provider;
    this.signer = signer;
    this.db = db;

    wireRevolutHooks({
      audit: this.audit,
      chainLog: this.chainLog,
      dss: (amountMinor) => {
        if (amountMinor > this.caps.per_tx_gbp) {
          throw new Error("DSS cap breach: per-transaction limit");
        }
      },
    });
  }

  setCaps(nextCaps) {
    this.caps = { ...this.caps, ...(nextCaps || {}) };
  }

  async engineerPayout(args) {
    const {
      runId,
      amountMinor,
      amountWei,
      tokenAddr,
      currency = "GBP",
      beneficiaryId,
      recipient,
      reference = "task_payout",
      userId,
      wallet,
      gasLimit,
      taskId,      //  for widget linkage
      engineerId,  //  for widget linkage
    } = args;

    if (!runId) throw new Error("runId is required");
    if (typeof amountMinor !== "number") {
      throw new Error("amountMinor (GBP pennies) is required");
    }

    const isDss = process.env.DSS_MODE === "true";

    if (isDss) {
      if (!this.provider || !this.signer || !this.db) {
        throw new Error("DSS payout needs provider, signer, and db models");
      }
      if (!recipient) throw new Error("recipient is required for DSS payouts");
      if (amountWei == null) throw new Error("amountWei is required for DSS payouts");

      const out = await PaymentService.processPayout({
        provider: this.provider,
        signer: this.signer,
        tokenAddr: tokenAddr || null,
        recipient,
        amountWei,
        amountGBP: amountMinor / 100,
        runId,
        reason: reference || "payout",
        db: this.db,
        userId,
        wallet,
        allowlist: true,
        gasLimit,
        nonDssFallback: null,
      });

      await this.chainLog("DSS_PAYOUT_OK", {
        runId,
        txHash: out.txHash,
        recipient,
        tokenAddr: tokenAddr || "ETH",
        amountMinor,
      });

      this.audit?.("payout.dss.success", { runId, redacted: true });

      // 🔔 WebSocket – payout event for Job Wallet / earnings widgets
      widgetBus.broadcastWidgetEvent({
        topic: "payout",
        action: "completed",
        payload: {
          mode: "DSS",
          runId,
          taskId: taskId || null,
          engineerId: engineerId || userId || null,
          amountMinor,
          currency: "GBP",
          txHash: out.txHash,
          completedAt: new Date().toISOString(),
        },
      });

      return { provider: "dss", result: out };
    }

    // Non-DSS route → Revolut fiat payout
    const amount = money.fromMinor(amountMinor);

    if (amountMinor > this.caps.per_tx_gbp) {
      throw new Error("DSS cap breach: per-transaction limit");
    }

    const res = await RevolutGateway.createFiatPayout({
      amount,
      currency,
      beneficiaryId,
      reference,
      idempotencyKey: runId,
    });

    await this.chainLog("FIAT_PAYOUT_OK", {
      runId,
      beneficiaryId,
      currency,
      amountMinor,
      provider: "revolut",
    });

    this.audit?.("payout.revolut.success", { runId, redacted: true });

    // 🔔 WebSocket – payout event
    widgetBus.broadcastWidgetEvent({
      topic: "payout",
      action: "completed",
      payload: {
        mode: "REVOLUT",
        runId,
        taskId: taskId || null,
        engineerId: engineerId || userId || null,
        amountMinor,
        currency,
        revolutPaymentId: res.id || null,
        completedAt: new Date().toISOString(),
      },
    });

    return { provider: "revolut", result: res };
  }

  // ... cardForMaterials, invoiceForClient, getPaymentStatus stay as they are ...
}

export default PaymentOrchestrator;
