// api/src/routes/clientRoutes.js
import express from "express";
import { createTicket, listTickets } from "../controllers/clientTicketController.js";

const router = express.Router();

router.get("/tickets", listTickets);
router.post("/tickets", createTicket);

export default router;
