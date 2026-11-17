import {
  ALERT_DEDUPE_MS,
  ALERT_TIMEOUT_MS,
  errorMessage,
  log,
  optionalEnv,
} from "./config";
import type { AnswerReason } from "./gemini";
import { line, withTimeout } from "./line";

export type AlertReason = Exclude<AnswerReason, "answered"> | "sheet_unavailable";

const REASON_TEXT: Record<AlertReason, string> = {
  not_in_faq: "ไม่มีใน FAQ → ควรเพิ่มแถวใน Sheet",
  incomplete: "Gemini ตอบไม่ครบ (ระบบ)",
  timeout: "Gemini ตอบช้าเกินเวลา (ระบบ) · FAQ อาจมีคำตอบอยู่แล้ว",
  error: "Gemini error / โควตาเต็ม (ระบบ) · FAQ อาจมีคำตอบอยู่แล้ว",
  sheet_unavailable: "อ่าน FAQ Sheet ไม่ได้ (ระบบ)",
};

const MAX_ALERT_QUESTION_CHARS = 300;
const MIN_ALERT_MS = 300; // not worth starting a call with less time than this

// Per warm instance only: a cold start may send one extra LINE alert. Good enough.
const lastLineAlert = new Map<string, number>();

function shouldPushLine(userId: string): boolean {
  const now = Date.now();
  for (const [id, at] of lastLineAlert) {
    if (now - at > ALERT_DEDUPE_MS) lastLineAlert.delete(id);
  }
  if (lastLineAlert.has(userId)) return false;
  lastLineAlert.set(userId, now);
  return true;
}

function bangkokTime(): string {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Display name helps admins find the chat in LINE OA Manager; falls back to "-". */
async function displayName(userId: string, ms: number): Promise<string> {
  try {
    const profile = await withTimeout(line().getProfile(userId), ms, "getProfile");
    return profile.displayName;
  } catch {
    return "-";
  }
}

async function pushToAdminGroup(groupId: string, text: string, ms: number) {
  await withTimeout(
    line().pushMessage({ to: groupId, messages: [{ type: "text", text }] }),
    ms,
    "pushMessage",
  );
}

/** Append one row to the "Unanswered" sheet via the Apps Script web app. */
async function logToSheet(url: string, row: Record<string, string>, ms: number) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...row, secret: optionalEnv("UNANSWERED_SHEET_SECRET") ?? "" }),
    // Apps Script always answers 302 → script.googleusercontent.com, even for
    // "unauthorized" or a login page. Follow it (fetch turns it into a GET) and
    // check that doPost really said "ok".
    redirect: "follow",
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`sheet_log_http_${res.status}`);
  const body = (await res.text()).trim();
  if (body !== "ok") {
    const hint = body.startsWith("<")
      ? "got_html: check Deploy → Who has access = Anyone, and use the /exec URL"
      : body.slice(0, 80);
    throw new Error(`sheet_log_rejected: ${hint}`);
  }
}

/**
 * Tell admins the bot could not answer: LINE push to ADMIN_LINE_GROUP_ID (once per
 * customer per 10 min) and a row in the Unanswered sheet (every time).
 * Never throws. Each channel is skipped when its env var is not set.
 * The question goes only to these admin channels — logs keep length/IDs only.
 */
export async function alertAdmin(args: {
  userId: string;
  question: string;
  reason: AlertReason;
  deadline: number; // epoch ms the whole request must finish by
}): Promise<void> {
  const groupId = optionalEnv("ADMIN_LINE_GROUP_ID");
  const sheetUrl = optionalEnv("UNANSWERED_SHEET_URL");
  if (!groupId && !sheetUrl) return;

  const user = args.userId.slice(-6);
  const budget = () => Math.min(ALERT_TIMEOUT_MS, args.deadline - Date.now());
  if (budget() < MIN_ALERT_MS) {
    log("warn", "alert_skipped_no_time", { user, reason: args.reason });
    return;
  }

  const name = await displayName(args.userId, Math.min(1_000, budget()));
  const question =
    args.question.length > MAX_ALERT_QUESTION_CHARS
      ? `${args.question.slice(0, MAX_ALERT_QUESTION_CHARS)}…`
      : args.question;
  const time = bangkokTime();

  const tasks: { channel: string; run: (ms: number) => Promise<void> }[] = [];
  if (groupId && shouldPushLine(args.userId)) {
    const text = [
      "⚠️ บอทตอบไม่ได้ ช่วยตามตอบลูกค้าด้วยครับ",
      `ลูกค้า: ${name} (…${user})`,
      `ถาม: "${question}"`,
      `สาเหตุ: ${REASON_TEXT[args.reason]}`,
      `เวลา: ${time}`,
      "ตอบได้ที่ LINE OA Manager → แชท",
    ].join("\n");
    tasks.push({ channel: "line", run: (ms) => pushToAdminGroup(groupId, text, ms) });
  }
  if (sheetUrl) {
    const row = { time, name, user, question, reason: args.reason };
    tasks.push({ channel: "sheet", run: (ms) => logToSheet(sheetUrl, row, ms) });
  }

  const ms = budget();
  if (ms < MIN_ALERT_MS) {
    log("warn", "alert_skipped_no_time", { user, reason: args.reason });
    return;
  }
  const started = Date.now();
  const results = await Promise.allSettled(tasks.map((t) => t.run(ms)));
  results.forEach((r, i) => {
    const channel = tasks[i].channel;
    if (r.status === "fulfilled") {
      log("info", "alert_sent", { channel, reason: args.reason, user, ms: Date.now() - started });
    } else {
      log("error", "alert_failed", {
        channel,
        reason: args.reason,
        user,
        status: (r.reason as { status?: number }).status,
        message: errorMessage(r.reason),
      });
    }
  });
}
