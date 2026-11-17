import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from "@google/genai";
import {
  DEFAULT_REPLY,
  GEMINI_FALLBACK_MODEL,
  GEMINI_MIN_FALLBACK_MS,
  GEMINI_MODEL,
  GEMINI_PRIMARY_TIMEOUT_MS,
  GEMINI_TIMEOUT_MS,
  errorMessage,
  getEnv,
  log,
} from "./config";
import { buildPrompt } from "./prompt";

let ai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!ai) ai = new GoogleGenAI({ apiKey: getEnv("GEMINI_API_KEY") });
  return ai;
}

/** Remove markdown that slips through (**, #, `) and trim. */
function cleanText(text: string): string {
  return text.replace(/\*\*/g, "").replace(/#/g, "").replace(/`/g, "").trim();
}

/**
 * Why the customer got this text. Anything other than "answered" means they got
 * DEFAULT_REPLY and an admin should follow up.
 *  - not_in_faq: Gemini found nothing relevant in the FAQ → add a row to the Sheet
 *  - incomplete: answer cut off / blocked (finishReason ≠ STOP) or empty
 *  - timeout / error: Gemini was slow, over quota or down → FAQ may already cover it
 */
export type AnswerReason =
  | "answered"
  | "not_in_faq"
  | "incomplete"
  | "timeout"
  | "error";
export type Answer = { text: string; reason: AnswerReason };

// The prompt makes Gemini say DEFAULT_REPLY verbatim; match its opening phrase so
// small variations (spacing, emoji) still count as "not in FAQ".
const DEFAULT_MARKER = "ขอเช็กข้อมูลก่อน";
function isDefaultText(text: string): boolean {
  return text.replace(/\s/g, "").includes(DEFAULT_MARKER);
}

class TimeoutError extends Error {
  constructor(public readonly model: string) {
    super(`timeout: ${model}`);
  }
}

/** Overloaded / rate-limited / transient server errors worth retrying on another model. */
function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof ApiError) {
    return err.status === 503 || err.status === 429 || err.status === 500;
  }
  return /\b(503|429|500)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(
    errorMessage(err),
  );
}

function errorStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}

/** One generateContent call with its own timeout. Throws TimeoutError on timeout. */
async function attempt(
  model: string,
  contents: string,
  config: GenerateContentConfig,
  timeoutMs: number,
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await client().models.generateContent({
      model,
      contents,
      config: { ...config, abortSignal: controller.signal },
    });
  } catch (err) {
    throw timedOut ? new TimeoutError(model) : err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Gemini to answer from the FAQ only.
 * Main model gets GEMINI_PRIMARY_TIMEOUT_MS; if it is slow or overloaded,
 * GEMINI_FALLBACK_MODEL gets the rest of the GEMINI_TIMEOUT_MS budget.
 * Never throws: any failure, timeout, truncation or empty answer returns DEFAULT_REPLY
 * with a reason other than "answered".
 */
export async function askGemini(
  faqCsv: string,
  question: string,
): Promise<Answer> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const contents = buildPrompt(faqCsv, question);
  // thinkingLevel is only accepted by explicit gemini-3.x model ids; aliases and
  // other families get the model's own default instead.
  const configFor = (m: string): GenerateContentConfig => ({
    temperature: 1.0, // Gemini 3.x default · do not lower
    maxOutputTokens: 1024, // thinking + answer share this budget · do not drop to 200
    ...(m.startsWith("gemini-3")
      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
      : {}),
  });

  let model = GEMINI_MODEL;
  try {
    let res: GenerateContentResponse;
    try {
      res = await attempt(
        model,
        contents,
        configFor(model),
        GEMINI_PRIMARY_TIMEOUT_MS,
      );
    } catch (err) {
      const remaining = GEMINI_TIMEOUT_MS - elapsed();
      if (!isRetryable(err) || remaining < GEMINI_MIN_FALLBACK_MS) throw err;
      log("warn", "gemini_retry_fallback", {
        from: model,
        to: GEMINI_FALLBACK_MODEL,
        reason: err instanceof TimeoutError ? "timeout" : errorStatus(err),
        ms: elapsed(),
      });
      model = GEMINI_FALLBACK_MODEL;
      res = await attempt(model, contents, configFor(model), remaining);
    }

    const finishReason = res.candidates?.[0]?.finishReason;
    log("info", "gemini_response", {
      model,
      faqChars: faqCsv.length, // spot a wrong/empty sheet without logging its content
      finishReason,
      thoughtsTokenCount: res.usageMetadata?.thoughtsTokenCount,
      candidatesTokenCount: res.usageMetadata?.candidatesTokenCount,
      ms: elapsed(),
    });

    // MAX_TOKENS → half sentence; SAFETY etc. → unusable. Both fall back.
    if (finishReason !== "STOP") return { text: DEFAULT_REPLY, reason: "incomplete" };

    const text = cleanText(res.text ?? "");
    if (!text) return { text: DEFAULT_REPLY, reason: "incomplete" };
    // Keep Gemini's text: it may answer part of the question before the default line.
    if (isDefaultText(text)) return { text, reason: "not_in_faq" };
    return { text, reason: "answered" };
  } catch (err) {
    if (err instanceof TimeoutError) {
      log("error", "gemini_timeout", { model, ms: elapsed() });
      return { text: DEFAULT_REPLY, reason: "timeout" };
    }
    log("error", "gemini_error", {
      model,
      status: errorStatus(err),
      message: errorMessage(err),
      ms: elapsed(),
    });
    return { text: DEFAULT_REPLY, reason: "error" };
  }
}
