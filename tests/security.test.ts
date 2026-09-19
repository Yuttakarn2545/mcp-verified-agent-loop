import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveWorkspacePath,
  WorkspaceSecurityError,
} from "../src/shared/security.js";

describe("workspace path policy", () => {
  const root = path.join(os.tmpdir(), "verified-agent-workspace");

  it("allows paths inside the workspace", () => {
    expect(resolveWorkspacePath(root, "src/index.ts")).toBe(
      path.resolve(root, "src/index.ts"),
    );
  });

  it("blocks parent traversal", () => {
    expect(() => resolveWorkspacePath(root, "../secret.txt")).toThrow(
      WorkspaceSecurityError,
    );
  });

  it("blocks absolute paths", () => {
    const absolute =
      process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/passwd";
    expect(() => resolveWorkspacePath(root, absolute)).toThrow(
      WorkspaceSecurityError,
    );
  });

  it("blocks protected directories", () => {
    expect(() => resolveWorkspacePath(root, ".git/config")).toThrow(
      WorkspaceSecurityError,
    );
    expect(() => resolveWorkspacePath(root, "node_modules/pkg/index.js")).toThrow(
      WorkspaceSecurityError,
    );
    expect(() => resolveWorkspacePath(root, ".env")).toThrow(
      WorkspaceSecurityError,
    );
  });
});
