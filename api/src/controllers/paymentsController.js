// api/src/controllers/paymentsController.js
import mongoose from "mongoose";
import * as widgetBus from "../realtime/widgetBus.js";

/**
 * Demo-safe escrow ledger store.
 * We use a raw Mongo collection so you don't need to define a schema/model.
 *
 * Collection: escrow_ledger
 * Docs:
 *  - { kind: "DEPOSIT"|"RELEASE"|"REFUND", amountGBP, ref, clientId, createdAt }
 */
function ledgerCollection() {
  return mongoose.connection.collection("escrow_ledger");
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Compute balances for a given clientId.
 * held = deposits - releases - refunds
 */
async function computeBalances({ clientId }) {
  const col = ledgerCollection();

  const pipeline = [
    { $match: { clientId } },
    {
      $group: {
        _id: "$kind",
        total: { $sum: "$amountGBP" }
      }
    }
  ];

  const rows = await col.aggregate(pipeline).toArray();

  const sums = rows.reduce((acc, r) => {
    acc[r._id] = toNumber(r.total, 0);
    return acc;
  }, {});

  const deposited = toNumber(sums.DEPOSIT, 0);
  const released = toNumber(sums.RELEASE, 0);
  const refunded = toNumber(sums.REFUND, 0);

  const held = Math.max(0, deposited - released - refunded);

  // Find the latest ledger timestamp (for UI “Last update” if you still want it)
  const latest = await col
    .find({ clientId })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  const lastUpdatedAt = latest?.[0]?.createdAt
    ? new Date(latest[0].createdAt).toISOString()
    : null;

  return {
    depositedGBP: deposited,
    releasedGBP: released,
    refundedGBP: refunded,
    heldGBP: held,
    lastUpdatedAt
  };
}

/**
 * POST /api/payments/escrow/deposit
 * Body: { amountGBP, ref?, payerLabel? }
 *
 * - Writes a DEPOSIT entry to escrow_ledger
 * - Broadcasts WS event: topic="ticket", action="escrow_updated"
 *   so the Escrow widget updates immediately.
 */
export async function escrowDeposit(req, res) {
  try {
    const clientId =
      String(req.headers["x-demo-client-id"] || req.body?.clientId || "client_demo_001");

    const amountGBP = toNumber(req.body?.amountGBP, NaN);
    if (!Number.isFinite(amountGBP) || amountGBP <= 0) {
      return res.status(400).json({
        ok: false,
        error: "amountGBP must be a positive number"
      });
    }

    const ref = String(req.body?.ref || "L39-DEMO-ESCROW");
    const payerLabel = String(req.body?.payerLabel || "Demo Client / FM");

    const entry = {
      kind: "DEPOSIT",
      amountGBP,
      ref,
      payerLabel,
      clientId,
      createdAt: new Date()
    };

    await ledgerCollection().insertOne(entry);

    const balances = await computeBalances({ clientId });

    // ✅ Real-time update for the Escrow widget
    widgetBus.broadcastWidgetEvent({
      topic: "ticket",
      action: "escrow_updated",
      payload: {
        clientId,
        ref,
        heldGBP: balances.heldGBP,
        releasedGBP: balances.releasedGBP,
        refundedGBP: balances.refundedGBP,
        depositedGBP: balances.depositedGBP,
        updatedAt: nowIso()
      },
      recipients: { roles: ["CLIENT_FM", "DAO_ADMIN"] }
    });

    return res.json({
      ok: true,
      message: `Deposit confirmed: £${amountGBP.toFixed(2)} held in escrow.`,
      entry: {
        kind: entry.kind,
        amountGBP: entry.amountGBP,
        ref: entry.ref,
        payerLabel: entry.payerLabel,
        clientId,
        createdAt: entry.createdAt.toISOString()
      },
      balances
    });
  } catch (e) {
    console.error("escrowDeposit failed:", e);
    return res.status(500).json({ ok: false, error: e?.message || "escrowDeposit failed" });
  }
}

/**
 * GET /api/payments/escrow/status
 * Returns balances + recent ledger entries.
 */
export async function escrowStatus(req, res) {
  try {
    const clientId = String(req.headers["x-demo-client-id"] || "client_demo_001");
    const balances = await computeBalances({ clientId });

    const entries = await ledgerCollection()
      .find({ clientId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    return res.json({
      ok: true,
      clientId,
      balances,
      entries: entries.map((x) => ({
        kind: x.kind,
        amountGBP: x.amountGBP,
        ref: x.ref,
        payerLabel: x.payerLabel,
        createdAt: x.createdAt ? new Date(x.createdAt).toISOString() : null
      }))
    });
  } catch (e) {
    console.error("escrowStatus failed:", e);
    return res.status(500).json({ ok: false, error: e?.message || "escrowStatus failed" });
  }
}
