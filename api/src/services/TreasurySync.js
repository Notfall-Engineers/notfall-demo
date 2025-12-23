// src/services/TreasurySync.js
const TreasurySync = {
  async mintFeeNFTL({ feeGBP, workflowId }) {
    // Rough demo – 1 NFTL per £1 fee
    const tokens = BigInt(Math.round(feeGBP));
    return { workflowId, tokens };
  },
};

export default TreasurySync;
