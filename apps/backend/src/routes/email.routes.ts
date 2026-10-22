import { Router } from "express";

import {
  getEmails,
  getEmailById,
  overrideEmail,
  processEmails,
  retryFailedEmail,
  processSingleEmail,
} from "../controllers/email.controller";

const router = Router();

router.get("/", getEmails);

router.get("/:id", getEmailById);

router.patch("/:id/override", overrideEmail);

router.post("/process", processEmails);

router.post("/:id/process", processSingleEmail);

router.post("/:id/retry", retryFailedEmail);

export default router;
