import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Minimal .env loader (no extra dependency). Never overrides real env vars. */
export function loadDotenv(file?: string): void {
  const path = file ?? join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Load the app env file: KARDATA_ENV_FILE when set (dev instance), else
 * the default .env (prod). Real environment variables always win.
 */
export function loadAppEnv(): void {
  loadDotenv(process.env.KARDATA_ENV_FILE);
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

/** Comma-separated folders that CSV import paths may come from. */
export function getImportDirs(): string[] {
  return (process.env.KARDATA_IMPORT_DIRS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
