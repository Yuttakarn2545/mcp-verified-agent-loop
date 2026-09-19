import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpSession {
  client: Client;
  close: () => Promise<void>;
}

interface TextContent {
  type: "text";
  text: string;
}

function isTextContent(value: unknown): value is TextContent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.type === "text" && typeof candidate.text === "string";
}

export async function createMcpSession(workspaceRoot: string): Promise<McpSession> {
  const currentFile = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFile), "../..");
  const serverEntry = path.join(projectRoot, "src", "mcp", "server.ts");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverEntry],
    cwd: projectRoot,
    env: {
      ...getDefaultEnvironment(),
      MCP_WORKSPACE_ROOT: path.resolve(workspaceRoot),
    },
    stderr: "inherit",
  });

  const client = new Client(
    {
      name: "verified-agent-demo",
      version: "1.0.0",
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

export async function callJsonTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({
    name,
    arguments: args,
  });

  const raw = result as unknown as {
    content?: unknown[];
    isError?: boolean;
  };
  const first = (raw.content ?? []).find(isTextContent);

  if (!first) {
    throw new Error(`Tool ${name} returned no text result.`);
  }

  if (raw.isError) {
    throw new Error(`Tool ${name} failed: ${first.text}`);
  }

  try {
    return JSON.parse(first.text) as T;
  } catch {
    return first.text as T;
  }
}
