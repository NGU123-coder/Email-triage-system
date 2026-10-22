import "dotenv/config";
import { processPendingEmails } from "../apps/backend/src/services/triage.service";

async function main() {
  console.log("Starting email processing...");

  await processPendingEmails();

  console.log("Email processing completed");
}

main();
