import express from "express";
import cors from "cors";
import emailRoutes from "./routes/email.routes";
import toolCallRoutes from "./routes/tool-call.routes";
import uploadRoutes from "./routes/upload.routes";
import healthRoutes from "./routes/health.routes";
import { notFoundMiddleware } from "./middleware/not-found.middleware";
import { errorMiddleware } from "./middleware/error.middleware";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    message: "AI Email Triage API is running",
  });
});

app.use("/health", healthRoutes);
app.use("/emails", emailRoutes);
app.use("/tool-calls", toolCallRoutes);
app.use("/upload-csv", uploadRoutes);

// 404 + error handlers must be registered last.
app.use(notFoundMiddleware);
app.use(errorMiddleware);

export default app;
