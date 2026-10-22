import { Router } from "express";

import multer from "multer";

import { ingestCsv } from "../services/csv-ingestion.service";

const router = Router();

const upload = multer({
  dest: "uploads/",
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const result = await ingestCsv(req.file.path);

    return res.status(200).json({
      success: true,
      filename: req.file.originalname,
      uploadedFile: req.file.filename,
      insertedCount: result.insertedCount,
    });
  } catch (error) {
    console.error(error);

    if (
      typeof error === "object" &&
      error !== null &&
      "missingColumns" in error
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid CSV format",
        missingColumns: (error as { missingColumns: string[] }).missingColumns,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Upload failed",
    });
  }
});

export default router;
