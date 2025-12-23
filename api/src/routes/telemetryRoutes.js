import { Router } from "express";
import { postTelemetry } from "../controllers/telemetryController.js";

const r = Router();

r.post("/", postTelemetry);

export default r;
