import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpSession } from "./agent/client.js";
import { runDemoAgent } from "./agent/demo-agent.js";
import { runProcess } from "./shared/process.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const templateRoot = path.join(projectRoot, "examples", "demo-repo");
const workspaceRoot = path.join(projectRoot, ".agent-workspace", "demo-repo");

async function prepareWorkspace(): Promise<void> {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workspaceRoot), { recursive: true });
  await fs.cp(templateRoot, workspaceRoot, { recursive: true });

  const commands: Array<[string, string[]]> = [
    ["git", ["init", "-q"]],
    ["git", ["config", "user.name", "MCP Demo"]],
    ["git", ["config", "user.email", "demo@example.invalid"]],
    ["git", ["add", "."]],
    ["git", ["commit", "-q", "-m", "baseline"]],
  ];

  for (const [command, args] of commands) {
    const result = await runProcess(command, args, workspaceRoot, 10_000);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to prepare demo workspace: ${command} ${args.join(" ")}\n${result.stderr}`,
      );
    }
  }
}

const autoApprove = process.argv.includes("--approve");

await prepareWorkspace();

const session = await createMcpSession(workspaceRoot);

try {
  await runDemoAgent({
    client: session.client,
    projectRoot,
    autoApprove,
  });
} finally {
  await session.close();
}
