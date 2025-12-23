// src/routes/index.js
import express from "express";
import clientRoutes from "./clientRoutes.js";
import engineerRoutes from "./engineerRoutes.js";
import adminRoutes from "./adminRoutes.js";
import layoutRoutes from "./layoutRoutes.js";
import clientTicketRoutes from "./routes/clientTicketRoutes.js";

// ...


const router = express.Router();

router.use("/client", clientRoutes);
router.use("/engineer", engineerRoutes);
router.use("/admin", adminRoutes);
router.use("/user", layoutRoutes); // layout prefs for any role

router.use("/api/client", clientTicketRoutes);

export default router;
