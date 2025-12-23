// src/routes/mainRoutes.js
import express from "express";
import clientRoutes from "./clientRoutes.js";
import engineerRoutes from "./engineerRoutes.js";
import adminRoutes from "./adminRoutes.js";
import layoutRoutes from "./layoutRoutes.js";

const router = express.Router();

router.use("/client", clientRoutes);
router.use("/engineer", engineerRoutes);
router.use("/admin", adminRoutes);
router.use("/user", layoutRoutes); // /api/user/layout

export default router;
