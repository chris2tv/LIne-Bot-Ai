export const GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_REPLY =
  "ขอเช็กข้อมูลก่อนนะครับ เดี๋ยวแอดมินตัวจริงมาตอบเร็วๆ นี้ 🙏";
export const FAQ_CACHE_MS = 60_000;
export const GEMINI_TIMEOUT_MS = 7_000;
export const SHEET_TIMEOUT_MS = 3_000;
export const MAX_QUESTION_CHARS = 500;

type EnvName =
  | "LINE_CHANNEL_ACCESS_TOKEN"
  | "LINE_CHANNEL_SECRET"
  | "GEMINI_API_KEY"
  | "SHEET_CSV_URL";

/** Read a required env var. Throws if missing or blank (never logs the value). */
export function getEnv(name: EnvName): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`missing_env: ${name}`);
  }
  return value.trim();
}

/** One-line JSON log so Vercel Logs stay grep-able. */
export function log(
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
