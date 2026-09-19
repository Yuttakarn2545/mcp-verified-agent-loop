import fs from "node:fs/promises";
import path from "node:path";

export interface AuditEvent {
  at: string;
  phase: string;
  action: string;
  detail: unknown;
}

export class AuditTrail {
  private readonly events: AuditEvent[] = [];

  add(phase: string, action: string, detail: unknown): void {
    this.events.push({
      at: new Date().toISOString(),
      phase,
      action,
      detail,
    });
  }

  all(): AuditEvent[] {
    return [...this.events];
  }

  async save(directory: string): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(
      directory,
      `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await fs.writeFile(file, JSON.stringify(this.events, null, 2), "utf8");
    return file;
  }
}
