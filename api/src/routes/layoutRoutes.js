// src/routes/layoutRoutes.js
import express from "express";
import { getLayout, saveLayout } from "../controllers/layoutController.js";

const router = express.Router();

router.get("/layout", getLayout);
router.put("/layout", saveLayout);

export default router;
