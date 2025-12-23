// api/src/services/PaymentService.js
// Core on-chain payout logic for Notfall DSS / TreasuryVault.
// This module is consumed by PaymentOrchestrator.js.

import { ethers } from "ethers";

/**
 * @typedef {Object} ProcessPayoutArgs
 * @property {ethers.JsonRpcProvider} provider
 * @property {ethers.Wallet} signer
 * @property {string|null} tokenAddr  ERC20 token address, or null/zero for native
 * @property {string} recipient       Wallet address of engineer
 * @property {string|bigint} amountWei Amount in wei (BigInt or string)
 * @property {number} amountGBP       Amount in GBP (for logs)
 * @property {string} runId           Idempotency key / DSS run
 * @property {Object} db              { PayoutLog, CapsCounter }
 * @property {string|Object} userId   Engineer user id (String or ObjectId)
 * @property {string} wallet          Engineer wallet address (optional, for logs)
 * @property {boolean} allowlist      Whether to enforce on-chain allowlist
 * @property {number} [gasLimit]      Optional gas limit
 * @property {Function|null} nonDssFallback If provided, used when DSS_MODE=false
 */

/**
 * processPayout
 * Single entry point for DSS payouts (TreasuryVault or similar).
 * You can wire your actual contract here; this skeleton assumes:
 *
 *   contract.treasuryPayout(recipient, amountWei, tokenAddr)
 *
 */
async function processPayout({
  provider,
  signer,
  tokenAddr,
  recipient,
  amountWei,
  amountGBP,
  runId,
  db,
  userId,
  wallet,
  allowlist = true,
  gasLimit,
  nonDssFallback = null,
}) {
  const { PayoutLog, CapsCounter } = db || {};

  if (!provider || !signer) {
    if (nonDssFallback) {
      // Optional: delegate to a non-DSS fallback like Revolut/Stripe
      return nonDssFallback();
    }
    throw new Error("processPayout requires provider + signer in DSS mode");
  }

  if (!recipient) {
    throw new Error("recipient is required");
  }
  if (amountWei == null) {
    throw new Error("amountWei is required");
  }

  // ---- Idempotency check (PayoutLog) --------------------------------------
  const existing = await PayoutLog.findOne({ runId }).lean();
  if (existing && existing.txHash) {
    return {
      txHash: existing.txHash,
      alreadyProcessed: true,
    };
  }

  // ---- Caps / risk (simplified) ------------------------------------------
  if (CapsCounter) {
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await CapsCounter.findOneAndUpdate(
      {
        userId: userId || null,
        day: todayKey,
      },
      {
        $inc: { attemptedMinor: Math.round(amountGBP * 100) },
      },
      { upsert: true }
    );
  }

  // ---- Connect to TreasuryVault (stub – replace ABI/address) -------------
  // Example placeholders:
  const treasuryAddress = process.env.TREASURY_VAULT_ADDRESS;
  const treasuryAbi = [
    // Minimal interface – replace with your real ABI
    "function payout(address recipient, uint256 amountWei, address token) external returns (bytes32 txRef)",
  ];

  if (!treasuryAddress) {
    throw new Error("TREASURY_VAULT_ADDRESS not configured");
  }

  const treasury = new ethers.Contract(treasuryAddress, treasuryAbi, signer);

  const opts = {};
  if (!tokenAddr || tokenAddr === ethers.ZeroAddress) {
    // Native token (ETH/crypto) – attach value
    opts.value = amountWei;
  }
  if (gasLimit) {
    opts.gasLimit = gasLimit;
  }

  // ---- Execute on-chain payout -------------------------------------------
  const tx = await treasury.payout(
    recipient,
    amountWei,
    tokenAddr || ethers.ZeroAddress,
    opts
  );

  const receipt = await tx.wait();

  // ---- Persist PayoutLog --------------------------------------------------
  const payoutDoc = await PayoutLog.findOneAndUpdate(
    { runId },
    {
      $set: {
        runId,
        userId: userId || null,
        wallet: wallet || recipient,
        tokenAddr: tokenAddr || ethers.ZeroAddress,
        amountWei: amountWei.toString(),
        amountGBP,
        txHash: receipt.transactionHash,
        status: "SUCCESS",
        chainId: await signer.getChainId(),
        processedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return {
    txHash: payoutDoc.txHash,
    runId,
    status: payoutDoc.status,
  };
}

/**
 * processFiatPayment
 * Simple placeholder for fiat rails (Stripe, bank, etc.).
 * You can expand this later – PaymentOrchestrator mainly cares about
 * processPayout() for DSS mode today.
 */
async function processFiatPayment({
  providerName,
  amountMinor,
  currency,
  reference,
  userId,
  db,
}) {
  const { PayoutLog } = db || {};

  // stub: no real payment – just log in DB
  const fakeId = `${providerName || "fiat"}_${Date.now()}`;

  if (PayoutLog) {
    await PayoutLog.create({
      runId: fakeId,
      userId: userId || null,
      wallet: null,
      tokenAddr: null,
      amountWei: "0",
      amountGBP:
        currency === "GBP" ? amountMinor / 100 : null,
      txHash: fakeId,
      status: "FAKE_OK",
      chainId: null,
      processedAt: new Date(),
      meta: {
        providerName,
        amountMinor,
        currency,
        reference,
      },
    });
  }

  return { paymentId: fakeId, provider: providerName || "fiat_stub" };
}

export default {
  processPayout,
  processFiatPayment,
};
