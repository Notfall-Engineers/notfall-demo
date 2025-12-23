// api/src/routes/paymentsRoutes.js
import { Router } from "express";
import {
  escrowDeposit,
  escrowStatus
} from "../controllers/paymentsController.js";

/**
 * Payments / Escrow (Demo-safe)
 *
 * These routes simulate Revolut-aligned escrow behaviour:
 *  - Deposit → funds HELD
 *  - Later: release / refund (future steps)
 *
 * All state changes broadcast real-time WS events so
 * widgets update instantly without polling.
 */
const r = Router();

/**
 * POST /api/payments/escrow/deposit
 *
 * Body:
 *  {
 *    amountGBP: number,
 *    ref?: string,
 *    payerLabel?: string
 *  }
 *
 * Effects:
 *  - Writes DEPOSIT entry to escrow ledger
 *  - Broadcasts ticket.escrow_updated
 */
r.post("/escrow/deposit", escrowDeposit);

/**
 * GET /api/payments/escrow/status
 *
 * Returns:
 *  - held / released / refunded balances
 *  - recent escrow ledger entries
 */
r.get("/escrow/status", escrowStatus);

export default r;
