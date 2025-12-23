// api/src/models/userModel.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ROLES = [
  "client",        // FM, landlord, enterprise, tenant
  "engineer",      // field engineer
  "admin",         // platform / DAO admin
  "dao_guardian",  // DSS / governance
];

// Optional: per-widget roles (for dashboard widgets, asset registry, etc.)
const widgetRoleSchema = new mongoose.Schema(
  {
    widgetKey: { type: String, required: true }, // e.g. "assetRegistry", "plcAlerts"
    role: {
      type: String,
      enum: ["viewer", "editor", "admin"],
      default: "viewer",
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false, // never return by default
    },

    // Core role used by auth / guards
    role: {
      type: String,
      enum: ROLES,
      default: "client",
      index: true,
    },

    // MFA flags (for “production mode” auth)
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      select: false,
    },

    // Optional: fine-grained widget access
    widgetRoles: {
      type: [widgetRoleSchema],
      default: [],
    },

    // Demo-only flags for your current environment
    demoFlags: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Hash password before save, if modified
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance method: compare passwords
userSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

// Avoid OverwriteModelError in dev / nodemon
const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
export { ROLES };
