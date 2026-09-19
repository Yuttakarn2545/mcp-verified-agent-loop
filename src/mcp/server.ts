import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { relativeWorkspacePath, resolveWorkspacePath } from "../shared/security.js";
import { runProcess } from "../shared/process.js";

const workspaceRoot = process.env.MCP_WORKSPACE_ROOT
  ? path.resolve(process.env.MCP_WORKSPACE_ROOT)
  : null;

if (!workspaceRoot) {
  throw new Error("MCP_WORKSPACE_ROOT is required.");
}

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const error = (message: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: message }],
});

async function walk(
  directory: string,
  currentDepth: number,
  maxDepth: number,
  output: string[],
): Promise<void> {
  if (currentDepth > maxDepth || output.length >= 250) return;

  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (output.length >= 250) return;
    if ([".git", "node_modules", ".agent-runs"].includes(entry.name)) continue;

    const absolute = path.join(directory, entry.name);
    const relative = relativeWorkspacePath(workspaceRoot!, absolute);

    if (entry.isDirectory()) {
      output.push(relative + "/");
      await walk(absolute, currentDepth + 1, maxDepth, output);
    } else {
      output.push(relative);
    }
  }
}

const server = new McpServer({
  name: "verified-workspace-tools",
  version: "1.0.0",
});

server.registerTool(
  "repo_list_files",
  {
    title: "List workspace files",
    description:
      "Lists files inside the sandboxed workspace. Protected directories are omitted.",
    inputSchema: {
      maxDepth: z.number().int().min(1).max(8).optional(),
    },
  },
  async ({ maxDepth }) => {
    try {
      const output: string[] = [];
      await walk(workspaceRoot, 1, maxDepth ?? 4, output);
      return text({ root: ".", files: output.sort() });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

server.registerTool(
  "repo_read_file",
  {
    title: "Read workspace file",
    description:
      "Reads a UTF-8 text file inside the workspace. Absolute paths and protected paths are rejected.",
    inputSchema: {
      path: z.string().min(1),
    },
  },
  async ({ path: requestedPath }) => {
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, requestedPath);
      const stats = await fs.stat(absolute);
      if (!stats.isFile()) return error("Requested path is not a file.");
      if (stats.size > 100_000) return error("File is larger than the 100 KB read limit.");
      const value = await fs.readFile(absolute, "utf8");
      return text({
        path: relativeWorkspacePath(workspaceRoot, absolute),
        content: value,
      });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

server.registerTool(
  "repo_search_text",
  {
    title: "Search workspace text",
    description:
      "Searches UTF-8 source files for a literal string and returns matching lines.",
    inputSchema: {
      query: z.string().min(1).max(200),
    },
  },
  async ({ query }) => {
    try {
      const files: string[] = [];
      await walk(workspaceRoot, 1, 6, files);
      const matches: Array<{ path: string; line: number; text: string }> = [];

      for (const relative of files) {
        if (relative.endsWith("/")) continue;
        const absolute = resolveWorkspacePath(workspaceRoot, relative);
        const stats = await fs.stat(absolute);
        if (stats.size > 100_000) continue;

        let value: string;
        try {
          value = await fs.readFile(absolute, "utf8");
        } catch {
          continue;
        }

        value.split(/\r?\n/).forEach((line, index) => {
          if (matches.length < 50 && line.includes(query)) {
            matches.push({ path: relative, line: index + 1, text: line.trim() });
          }
        });
      }

      return text({ query, matches });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

server.registerTool(
  "repo_write_file",
  {
    title: "Write workspace file",
    description:
      "Writes a UTF-8 file inside the sandbox. The tool cannot access parent directories, .git, node_modules, .env, or audit output.",
    inputSchema: {
      path: z.string().min(1),
      content: z.string().max(50_000),
    },
  },
  async ({ path: requestedPath, content }) => {
    try {
      const absolute = resolveWorkspacePath(workspaceRoot, requestedPath);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, content, "utf8");
      return text({
        written: relativeWorkspacePath(workspaceRoot, absolute),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

server.registerTool(
  "repo_run_verification",
  {
    title: "Run allowlisted verification",
    description:
      "Runs one of the fixed verification commands defined by this server. Arbitrary shell commands are never accepted.",
    inputSchema: {
      check: z.enum(["syntax", "test"]),
    },
  },
  async ({ check }) => {
    try {
      const spec =
        check === "syntax"
          ? { command: process.execPath, args: ["--check", "src/strings.js"] }
          : process.platform === "win32"
            ? {
                command: process.env.ComSpec ?? "cmd.exe",
                args: ["/d", "/s", "/c", "npm test"],
              }
            : { command: "npm", args: ["test"] };

      const result = await runProcess(spec.command, spec.args, workspaceRoot, 20_000);
      return text({
        check,
        exitCode: result.exitCode,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim(),
      });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

server.registerTool(
  "repo_diff",
  {
    title: "Inspect git diff",
    description:
      "Returns the current git diff for the sandboxed workspace. The command is fixed and cannot be changed by the caller.",
    inputSchema: {},
  },
  async () => {
    try {
      const result = await runProcess(
        "git",
        ["diff", "--no-ext-diff", "--unified=3"],
        workspaceRoot,
        10_000,
      );
      return text({
        exitCode: result.exitCode,
        diff: result.stdout.trim() || "(no changes)",
        stderr: result.stderr.trim(),
      });
    } catch (cause) {
      return error(cause instanceof Error ? cause.message : String(cause));
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
