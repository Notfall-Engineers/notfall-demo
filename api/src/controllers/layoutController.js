// src/controllers/layoutController.js
import LayoutPrefs from "../models/layoutPrefsModel.js";

export const getLayout = async (req, res, next) => {
  try {
    const userId = req.user?.id || "demo";
    const role = req.user?.role || "ENGINEER";
    const doc = await LayoutPrefs.findOne({ userId, role }).lean();
    res.json(
      doc || {
        userId,
        role,
        instances: [],
        updatedAt: new Date().toISOString(),
      }
    );
  } catch (err) {
    next(err);
  }
};

export const saveLayout = async (req, res, next) => {
  try {
    const userId = req.user?.id || "demo";
    const role = req.user?.role || "ENGINEER";
    const instances = req.body.instances || [];

    const doc = await LayoutPrefs.findOneAndUpdate(
      { userId, role },
      { $set: { instances, updatedAt: new Date() } },
      { upsert: true, new: true }
    ).lean();
    res.json(doc);
  } catch (err) {
    next(err);
  }
};
