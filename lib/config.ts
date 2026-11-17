// Flash-Lite: answered every FAQ test correctly in ~1-2s. gemini-3.6-flash hung >20s
// and hit 429 quota on this key (2026-11-16 local test), so it is no longer the default.
export const GEMINI_MODEL = "gemini-flash-lite-latest";
// Tried once if GEMINI_MODEL is slow, overloaded (503) or rate-limited (429/500).
export const GEMINI_FALLBACK_MODEL = "gemini-flash-latest";
export const DEFAULT_REPLY =
  "ขอเช็กข้อมูลก่อนนะครับ เดี๋ยวแอดมินตัวจริงมาตอบเร็วๆ นี้ 🙏";
export const FAQ_CACHE_MS = 60_000;
export const GEMINI_TIMEOUT_MS = 7_000; // total budget for all Gemini attempts
export const GEMINI_PRIMARY_TIMEOUT_MS = 4_500; // main model's share; the rest goes to the fallback
export const GEMINI_MIN_FALLBACK_MS = 1_000; // don't start a fallback with less time than this
export const SHEET_TIMEOUT_MS = 3_000;
export const MAX_QUESTION_CHARS = 500;
export const ALERT_TIMEOUT_MS = 2_500; // each admin alert (LINE push, Sheet log)
export const ALERT_DEDUPE_MS = 10 * 60_000; // one alert per customer per 10 min
export const REQUEST_BUDGET_MS = 9_500; // stay under maxDuration = 10s

type EnvName =
  | "LINE_CHANNEL_ACCESS_TOKEN"
  | "LINE_CHANNEL_SECRET"
  | "GEMINI_API_KEY"
  | "SHEET_CSV_URL";

/** Optional settings: admin alerts are skipped when these are not set. */
type OptionalEnvName =
  | "ADMIN_LINE_GROUP_ID"
  | "UNANSWERED_SHEET_URL"
  | "UNANSWERED_SHEET_SECRET";

export function optionalEnv(name: OptionalEnvName): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

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
