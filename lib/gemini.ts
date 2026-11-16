import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import {
  DEFAULT_REPLY,
  GEMINI_MODEL,
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
 * Ask Gemini to answer from the FAQ only.
 * Never throws: any failure, timeout, truncation or empty answer returns DEFAULT_REPLY.
 */
export async function askGemini(
  faqCsv: string,
  question: string,
): Promise<string> {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, GEMINI_TIMEOUT_MS);

  try {
    const res = await client().models.generateContent({
      model: GEMINI_MODEL,
      contents: buildPrompt(faqCsv, question),
      config: {
        temperature: 1.0, // Gemini 3.x default · do not lower
        maxOutputTokens: 1024, // thinking + answer share this budget · do not drop to 200
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: controller.signal,
      },
    });

    const finishReason = res.candidates?.[0]?.finishReason;
    log("info", "gemini_response", {
      finishReason,
      thoughtsTokenCount: res.usageMetadata?.thoughtsTokenCount,
      candidatesTokenCount: res.usageMetadata?.candidatesTokenCount,
      ms: Date.now() - started,
    });

    // MAX_TOKENS → half sentence; SAFETY etc. → unusable. Both fall back.
    if (finishReason !== "STOP") return DEFAULT_REPLY;

    const text = cleanText(res.text ?? "");
    return text || DEFAULT_REPLY;
  } catch (err) {
    if (timedOut) {
      log("error", "gemini_timeout", { ms: Date.now() - started });
    } else {
      log("error", "gemini_error", {
        message: errorMessage(err),
        ms: Date.now() - started,
      });
    }
    return DEFAULT_REPLY;
  } finally {
    clearTimeout(timer);
  }
}
