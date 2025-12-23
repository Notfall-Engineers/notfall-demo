// api/src/models/clientModel.js
import mongoose from "mongoose";

const kycSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    provider: { type: String, default: null },
    reference: { type: String, default: null },
    lastCheckedAt: { type: Date, default: null },
  },
  { _id: false }
);

const billingContactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

const propertySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    addressLine1: { type: String, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, trim: true },
    postcode: { type: String, trim: true },
    country: { type: String, trim: true },
  },
  {
    timestamps: true,
  }
);

const clientSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      unique: true,
    },

    companyName: {
      type: String,
      required: true,
      trim: true,
    },

    role: {
      type: String,
      trim: true,
      default: "Client / FM",
    },

    billingContact: billingContactSchema,

    isEnterprise: {
      type: Boolean,
      default: false,
      index: true,
    },

    kyc: kycSchema,

    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    properties: [propertySchema],
  },
  {
    timestamps: true,
  }
);

const Client = mongoose.model("Client", clientSchema);
export default Client;
