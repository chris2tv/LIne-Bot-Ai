import { validateSignature, type webhook } from "@line/bot-sdk";
import { waitUntil } from "@vercel/functions";
import { alertAdmin, type AlertReason } from "@/lib/alert";
import {
  ALERT_DEADLINE_MS,
  DEFAULT_REPLY,
  errorMessage,
  getEnv,
  log,
} from "@/lib/config";
import { askGemini } from "@/lib/gemini";
import { line } from "@/lib/line";
import { getFaqCsv } from "@/lib/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reply path stays within ~10s (Sheet 3s + Gemini 7s); the extra time is only for
// admin alerts that run after the 200 via waitUntil.
export const maxDuration = 20;

/** Last 6 chars of userId only — never log full IDs, message text or tokens. */
function shortUserId(event: webhook.Event): string | undefined {
  const userId = (event.source as { userId?: string } | undefined)?.userId;
  return userId ? userId.slice(-6) : undefined;
}

async function reply(replyToken: string, text: string, user?: string) {
  try {
    await line().replyMessage({
      replyToken,
      messages: [{ type: "text", text }],
    });
  } catch (err) {
    // replyToken is single-use: no retry.
    log("error", "line_reply_failed", {
      status: (err as { status?: number }).status,
      message: errorMessage(err),
      user,
    });
  }
}

/**
 * Bot added to a group (e.g. the admin group): reply with the group ID so it can be
 * put into ADMIN_LINE_GROUP_ID. A reply is free; it does not use push quota.
 */
async function handleJoin(event: webhook.JoinEvent): Promise<void> {
  const source = event.source;
  if (source?.type !== "group" || !event.replyToken) return;
  log("info", "bot_joined_group", { groupId: source.groupId });
  await reply(
    event.replyToken,
    [
      "สวัสดีครับ 👋 Group ID ของกลุ่มนี้คือ",
      source.groupId,
      "",
      "ถ้าจะใช้กลุ่มนี้รับแจ้งเตือนคำถามที่บอทตอบไม่ได้: นำ ID ไปใส่ใน Vercel → Settings → Environment Variables → ADMIN_LINE_GROUP_ID แล้วกด Redeploy",
    ].join("\n"),
  );
}

async function handleEvent(event: webhook.Event, deadline: number): Promise<void> {
  if (event.type === "join") return handleJoin(event);
  if (event.type !== "message" || event.message.type !== "text") return;
  // FAQ answers are for 1:1 chats only, so admins talking in the alert group
  // (or any other group) don't trigger the bot.
  if (event.source?.type !== "user") return;
  const replyToken = event.replyToken;
  if (!replyToken) return;

  const userId = event.source.userId;
  const user = shortUserId(event);
  const question = event.message.text;
  log("info", "message_received", { user, length: question.length });

  let answer = DEFAULT_REPLY;
  let reason: AlertReason | "answered";
  try {
    const faq = await getFaqCsv();
    ({ text: answer, reason } = await askGemini(faq, question));
  } catch (err) {
    log("error", "sheet_unavailable", { message: errorMessage(err), user });
    reason = "sheet_unavailable";
  }

  // Customer first. Admin alerts finish in the background after LINE gets its 200,
  // so a slow Apps Script never delays the webhook response.
  await reply(replyToken, answer, user);
  if (reason !== "answered" && userId) {
    waitUntil(alertAdmin({ userId, question, reason, deadline }));
  }
}

export async function GET() {
  return new Response("ok", { status: 200 });
}

export async function POST(req: Request) {
  const deadline = Date.now() + ALERT_DEADLINE_MS;
  // Raw body is required for signature verification — do not req.json() first.
  const body = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  let secret: string;
  try {
    secret = getEnv("LINE_CHANNEL_SECRET");
  } catch (err) {
    log("error", "config_error", { message: errorMessage(err) });
    return new Response("server misconfigured", { status: 500 });
  }

  if (!signature || !validateSignature(body, secret, signature)) {
    log("warn", "invalid_signature");
    return new Response("invalid signature", { status: 401 });
  }

  let events: webhook.Event[] = [];
  try {
    events = (JSON.parse(body) as webhook.CallbackRequest).events ?? [];
  } catch (err) {
    log("error", "invalid_body", { message: errorMessage(err) });
    return new Response("ok", { status: 200 });
  }

  // Empty events = "Verify" button in LINE Developers Console.
  if (events.length === 0) return new Response("ok", { status: 200 });

  // Await every reply before returning, or Vercel freezes the function mid-send.
  const results = await Promise.allSettled(events.map((e) => handleEvent(e, deadline)));
  for (const r of results) {
    if (r.status === "rejected") {
      log("error", "event_failed", { message: errorMessage(r.reason) });
    }
  }

  // Always 200 so LINE doesn't redeliver.
  return new Response("ok", { status: 200 });
}
