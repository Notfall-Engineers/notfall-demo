import { Router } from "express";
import { postTrack, getSummary } from "../controllers/analyticsController.js";

const r = Router();

r.post("/event", postTrack);
r.get("/summary", getSummary);

export default r;
