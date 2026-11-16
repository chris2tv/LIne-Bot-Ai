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
 * Never throws: any failure, timeout, truncation or empty answer returns DEFAULT_REPLY.
 */
export async function askGemini(
  faqCsv: string,
  question: string,
): Promise<string> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const contents = buildPrompt(faqCsv, question);
  const baseConfig: GenerateContentConfig = {
    temperature: 1.0, // Gemini 3.x default · do not lower
    maxOutputTokens: 1024, // thinking + answer share this budget · do not drop to 200
  };

  let model = GEMINI_MODEL;
  try {
    let res: GenerateContentResponse;
    try {
      res = await attempt(
        model,
        contents,
        { ...baseConfig, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
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
      // No thinkingConfig: the fallback may be a model that rejects thinkingLevel.
      res = await attempt(model, contents, baseConfig, remaining);
    }

    const finishReason = res.candidates?.[0]?.finishReason;
    log("info", "gemini_response", {
      model,
      finishReason,
      thoughtsTokenCount: res.usageMetadata?.thoughtsTokenCount,
      candidatesTokenCount: res.usageMetadata?.candidatesTokenCount,
      ms: elapsed(),
    });

    // MAX_TOKENS → half sentence; SAFETY etc. → unusable. Both fall back.
    if (finishReason !== "STOP") return DEFAULT_REPLY;

    const text = cleanText(res.text ?? "");
    return text || DEFAULT_REPLY;
  } catch (err) {
    if (err instanceof TimeoutError) {
      log("error", "gemini_timeout", { model, ms: elapsed() });
    } else {
      log("error", "gemini_error", {
        model,
        status: errorStatus(err),
        message: errorMessage(err),
        ms: elapsed(),
      });
    }
    return DEFAULT_REPLY;
  }
}
