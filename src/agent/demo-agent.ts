import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { AuditTrail } from "../shared/audit.js";
import { callJsonTool } from "./client.js";

interface FileRead {
  path: string;
  content: string;
}

interface VerifyResult {
  check: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface DiffResult {
  exitCode: number;
  diff: string;
  stderr: string;
}

interface DemoAgentOptions {
  client: Client;
  projectRoot: string;
  autoApprove: boolean;
}

export async function runDemoAgent({
  client,
  projectRoot,
  autoApprove,
}: DemoAgentOptions): Promise<void> {
  const audit = new AuditTrail();
  const task =
    "Add a production-friendly slugify(value) helper and tests without breaking titleCase.";

  console.log("\n=== MCP Verified Agent Loop ===");
  console.log("Task:", task);
  console.log("Mode: deterministic demo planner (no API key required)");
  console.log("All repository access is performed through MCP tools.\n");

  const files = await callJsonTool<{ files: string[] }>(
    client,
    "repo_list_files",
    { maxDepth: 4 },
  );
  audit.add("inspect", "repo_list_files", files.files);
  console.log("[inspect] files:", files.files.join(", "));

  const packageFile = await callJsonTool<FileRead>(
    client,
    "repo_read_file",
    { path: "package.json" },
  );
  audit.add("inspect", "repo_read_file", { path: packageFile.path });

  const sourceFile = await callJsonTool<FileRead>(
    client,
    "repo_read_file",
    { path: "src/strings.js" },
  );
  audit.add("inspect", "repo_read_file", { path: sourceFile.path });

  const existing = await callJsonTool<{ matches: unknown[] }>(
    client,
    "repo_search_text",
    { query: "slugify" },
  );
  audit.add("inspect", "repo_search_text", {
    query: "slugify",
    matches: existing.matches.length,
  });

  if (existing.matches.length > 0) {
    throw new Error("Demo workspace already contains slugify; expected a clean baseline.");
  }

  const plan = [
    "Keep the existing titleCase behavior unchanged.",
    "Add slugify as a small pure function in src/strings.js.",
    "Extend node:test coverage for whitespace, punctuation, and mixed case.",
    "Run the fixed syntax and test verification tools.",
    "Inspect the git diff and require human approval.",
  ];
  audit.add("plan", "create_plan", plan);

  console.log("\n[plan]");
  plan.forEach((item, index) => console.log(`  ${index + 1}. ${item}`));

  const updatedSource =
    sourceFile.content.trimEnd() +
    `

export function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
`;

  const updatedTests = `import test from "node:test";
import assert from "node:assert/strict";
import { slugify, titleCase } from "../src/strings.js";

test("titleCase normalizes words", () => {
  assert.equal(titleCase("  hello   WORLD "), "Hello World");
});

test("slugify creates a stable URL-safe slug", () => {
  assert.equal(slugify("  Hello, MCP Agent!  "), "hello-mcp-agent");
});

test("slugify collapses repeated punctuation and whitespace", () => {
  assert.equal(slugify("TypeScript + Go   + MCP"), "typescript-go-mcp");
});
`;

  const sourceWrite = await callJsonTool<{ written: string; bytes: number }>(
    client,
    "repo_write_file",
    {
      path: "src/strings.js",
      content: updatedSource,
    },
  );
  audit.add("implement", "repo_write_file", sourceWrite);

  const testWrite = await callJsonTool<{ written: string; bytes: number }>(
    client,
    "repo_write_file",
    {
      path: "tests/strings.test.js",
      content: updatedTests,
    },
  );
  audit.add("implement", "repo_write_file", testWrite);

  console.log(
    `\n[implement] updated ${sourceWrite.written} and ${testWrite.written}`,
  );

  const syntax = await callJsonTool<VerifyResult>(
    client,
    "repo_run_verification",
    { check: "syntax" },
  );
  audit.add("verify", "syntax", syntax);
  console.log(`[verify] syntax exit code: ${syntax.exitCode}`);

  if (syntax.exitCode !== 0) {
    throw new Error(`Syntax verification failed:\n${syntax.stderr}`);
  }

  const tests = await callJsonTool<VerifyResult>(
    client,
    "repo_run_verification",
    { check: "test" },
  );
  audit.add("verify", "test", tests);
  console.log(`[verify] tests exit code: ${tests.exitCode}`);

  if (tests.exitCode !== 0) {
    throw new Error(`Tests failed:\n${tests.stdout}\n${tests.stderr}`);
  }

  const diff = await callJsonTool<DiffResult>(client, "repo_diff", {});
  audit.add("review", "repo_diff", {
    exitCode: diff.exitCode,
    characters: diff.diff.length,
  });

  console.log("\n[diff]\n");
  console.log(diff.diff);

  let approved = autoApprove;

  if (!autoApprove) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question(
      "\nHuman approval required. Accept this verified change? [y/N] ",
    );
    rl.close();
    approved = /^y(es)?$/i.test(answer.trim());
  }

  audit.add("approval", approved ? "approved" : "rejected", {
    autoApprove,
  });

  const auditFile = await audit.save(path.join(projectRoot, ".agent-runs"));

  console.log(
    approved
      ? "\n[approval] APPROVED — verified change accepted in the sandbox."
      : "\n[approval] REJECTED — no merge/commit action performed.",
  );
  console.log("[audit]", auditFile);
}
