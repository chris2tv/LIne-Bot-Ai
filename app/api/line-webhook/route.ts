import { messagingApi, validateSignature, type webhook } from "@line/bot-sdk";
import { DEFAULT_REPLY, errorMessage, getEnv, log } from "@/lib/config";
import { askGemini } from "@/lib/gemini";
import { getFaqCsv } from "@/lib/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

let lineClient: messagingApi.MessagingApiClient | null = null;
function line(): messagingApi.MessagingApiClient {
  if (!lineClient) {
    lineClient = new messagingApi.MessagingApiClient({
      channelAccessToken: getEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    });
  }
  return lineClient;
}

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

async function handleEvent(event: webhook.Event): Promise<void> {
  if (event.type !== "message" || event.message.type !== "text") return;
  const replyToken = event.replyToken;
  if (!replyToken) return;

  const user = shortUserId(event);
  const question = event.message.text;
  log("info", "message_received", { user, length: question.length });

  let answer = DEFAULT_REPLY;
  try {
    const faq = await getFaqCsv();
    answer = await askGemini(faq, question);
  } catch (err) {
    log("error", "sheet_unavailable", { message: errorMessage(err), user });
  }

  await reply(replyToken, answer, user);
}

export async function GET() {
  return new Response("ok", { status: 200 });
}

export async function POST(req: Request) {
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
  const results = await Promise.allSettled(events.map(handleEvent));
  for (const r of results) {
    if (r.status === "rejected") {
      log("error", "event_failed", { message: errorMessage(r.reason) });
    }
  }

  // Always 200 so LINE doesn't redeliver.
  return new Response("ok", { status: 200 });
}
