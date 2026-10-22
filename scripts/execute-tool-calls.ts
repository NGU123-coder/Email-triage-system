import { executePendingToolCalls } from "../apps/backend/src/services/tool-executor.service";

async function main() {
  console.log("Starting tool execution...");

  await executePendingToolCalls();

  console.log("Tool execution completed");
}

main();
