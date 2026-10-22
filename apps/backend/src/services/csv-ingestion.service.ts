import fs from "fs";
import csv from "csv-parser";

import prisma from "../config/prisma";
import { parseEmailBody, parseSubject } from "../utils/email-parser";

const REQUIRED_COLUMNS = ["id", "from", "to", "cc", "subject", "date", "body"];

function parseDate(value: string): Date {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export async function ingestCsv(filePath: string) {
  return new Promise<{
    insertedCount: number;
  }>((resolve, reject) => {
    const emails: Record<string, string>[] = [];

    let validatedColumns = false;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("headers", (headers: string[]) => {
        const missingColumns = REQUIRED_COLUMNS.filter(
          (column) => !headers.includes(column),
        );

        if (missingColumns.length > 0) {
          reject({
            message: "Invalid CSV format",
            missingColumns,
          });

          return;
        }

        validatedColumns = true;
      })
      .on("data", (row) => {
        if (validatedColumns) {
          emails.push(row);
        }
      })
      .on("end", async () => {
        try {
          // Re-upload replaces the dataset: clear child tables first.
          await prisma.toolExecution.deleteMany({});
          await prisma.auditLog.deleteMany({});
          await prisma.toolCall.deleteMany({});
          await prisma.email.deleteMany({});

          for (const email of emails) {
            await prisma.email.create({
              data: {
                from: email.from || "",
                to: email.to || "",
                cc: email.cc || null,
                subject: parseSubject(email.subject || ""),
                // Parse at ingestion so stored text is already clean and
                // bounded (REQ-1.3); classifyEmail re-applies the same
                // parser defensively before the LLM call.
                body: parseEmailBody(email.body || ""),
                date: parseDate(email.date),
              },
            });
          }

          resolve({
            insertedCount: emails.length,
          });
        } catch (error) {
          reject(error);
        }
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}
