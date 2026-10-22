import fs from "fs";
import path from "path";
import csv from "csv-parser";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CSV_PATH = path.join(process.cwd(), "data", "sample_emails.csv");

type CsvEmailRow = {
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
};

async function main() {
  const emails: CsvEmailRow[] = [];

  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on("data", (row: CsvEmailRow) => {
      emails.push(row);
    })
    .on("end", async () => {
      console.log(`Parsed ${emails.length} emails`);

      for (const email of emails) {
        try {
          await prisma.email.create({
            data: {
              from: email.from,
              to: email.to,
              cc: email.cc || null,
              subject: email.subject,
              body: email.body,
              date: email.date ? new Date(email.date) : new Date(),
            },
          });
        } catch (error) {
          console.error("Failed inserting email:", email.subject);
        }
      }

      console.log("Email seeding completed");

      await prisma.$disconnect();
    });
}

main();
