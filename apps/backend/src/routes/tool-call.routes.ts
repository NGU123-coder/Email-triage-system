import { Router } from "express";

import {
  getToolCalls,
  executeTools,
  executeSingleTool,
  approveTool,
  rejectTool,
  updateToolArguments,
} from "../controllers/tool-call.controller";

const router = Router();

router.get("/", getToolCalls);

router.post("/execute", executeTools);

router.post("/:id/execute", executeSingleTool);

router.post("/:id/approve", approveTool);

router.post("/:id/reject", rejectTool);

router.patch("/:id/arguments", updateToolArguments);

export default router;
