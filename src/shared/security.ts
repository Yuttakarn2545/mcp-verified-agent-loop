import path from "node:path";

const BLOCKED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".env",
  ".agent-runs",
]);

export class WorkspaceSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceSecurityError";
  }
}

export function resolveWorkspacePath(root: string, requestedPath: string): string {
  if (!requestedPath || requestedPath.includes("\0")) {
    throw new WorkspaceSecurityError("Path is empty or invalid.");
  }

  if (path.isAbsolute(requestedPath)) {
    throw new WorkspaceSecurityError("Absolute paths are not allowed.");
  }

  const normalizedParts = requestedPath
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  if (normalizedParts.some((part) => BLOCKED_SEGMENTS.has(part))) {
    throw new WorkspaceSecurityError("Access to protected paths is blocked.");
  }

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requestedPath);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;

  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new WorkspaceSecurityError("Path traversal outside the workspace is blocked.");
  }

  return resolved;
}

export function relativeWorkspacePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}
