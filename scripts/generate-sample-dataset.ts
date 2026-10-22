import fs from "fs";
import path from "path";
import { simpleParser } from "mailparser";
import { createObjectCsvWriter } from "csv-writer";

const ROOT_DIR = path.join(process.cwd(), "data", "raw-enron", "maildir");
const OUTPUT_CSV = path.join(process.cwd(), "data", "sample_emails.csv");

type ParsedEmail = {
  id: number;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
};

const emails: ParsedEmail[] = [];

async function walkDirectory(directory: string): Promise<string[]> {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });

  const files = await Promise.all(
    entries.map(async (entry: fs.Dirent) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return await walkDirectory(fullPath);
      }
      return [fullPath];
    }),
  );

  return files.flat();
}

function cleanText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulEmail(email: Omit<ParsedEmail, "id">): boolean {
  const combined = `${email.subject} ${email.body}`.toLowerCase();

  const keywords = [
    "meeting",
    "urgent",
    "call",
    "follow up",
    "deadline",
    "issue",
    "client",
    "schedule",
    "asap",
    "review",
  ];

  return keywords.some((keyword) => combined.includes(keyword));
}

async function main() {
  const allFiles = await walkDirectory(ROOT_DIR);

  for (const filePath of allFiles) {
    if (emails.length >= 150) {
      break;
    }

    try {
      const rawEmail = fs.readFileSync(filePath);
      const parsed = await simpleParser(rawEmail);

      const emailData = {
        from: parsed.from?.text || "",
        to: (parsed.to as any)?.text || "",
        cc: (parsed.cc as any)?.text || "",
        subject: cleanText(parsed.subject || ""),
        date: parsed.date?.toISOString() || "",
        body: cleanText(parsed.text || ""),
      };

      if (emailData.subject && emailData.body && isUsefulEmail(emailData)) {
        emails.push({ id: emails.length + 1, ...emailData });
      }
    } catch (error) {
      console.error(`Failed parsing ${filePath}`);
    }
  }

  const csvWriter = createObjectCsvWriter({
    path: OUTPUT_CSV,
    header: [
      { id: "id", title: "id" },
      { id: "from", title: "from" },
      { id: "to", title: "to" },
      { id: "cc", title: "cc" },
      { id: "subject", title: "subject" },
      { id: "date", title: "date" },
      { id: "body", title: "body" },
    ],
  });

  await csvWriter.writeRecords(emails);

  console.log(`Generated ${emails.length} emails`);
}

main();
