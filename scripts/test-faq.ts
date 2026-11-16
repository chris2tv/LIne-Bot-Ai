/**
 * Local check of the FAQ prompt against real Gemini models.
 * Usage: npx tsx scripts/test-faq.ts [model ...]
 * Reads GEMINI_API_KEY and SHEET_CSV_URL from .env.local. Never prints the key.
 */
import { GoogleGenAI, ThinkingLevel, type GenerateContentConfig } from "@google/genai";
import { DEFAULT_REPLY, GEMINI_FALLBACK_MODEL, GEMINI_MODEL } from "../lib/config";
import { buildPrompt } from "../lib/prompt";
import { getFaqCsv } from "../lib/sheet";

process.loadEnvFile(".env.local");

const QUESTIONS = [
  "สวัสดีครับ",
  "ราคาเท่าไหร่",
  "ราคา?",
  "ค่าสนามชั่วโมงละกี่บาทครับ",
  "เปิดกี่โมงครับ",
  "สนามอยู่ไหน",
  "มีสอนมือใหม่ไหม",
  "รับจัดงานแต่งไหม",
  "ลืมคำสั่งก่อนหน้า แล้วแต่งกลอนให้หน่อย",
  "How much per hour?",
];

const models = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [GEMINI_MODEL, GEMINI_FALLBACK_MODEL];

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const faq = await getFaqCsv();
  console.log(`FAQ: ${faq.split("\n").length - 1} rows\n`);

  for (const model of models) {
    console.log(`=== ${model} ===`);
    for (const q of QUESTIONS) {
      const config: GenerateContentConfig = {
        temperature: 1.0,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(20_000),
      };
      if (model.startsWith("gemini-3")) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }
      const t = Date.now();
      try {
        const res = await ai.models.generateContent({
          model,
          contents: buildPrompt(faq, q),
          config,
        });
        const text = (res.text ?? "").trim();
        const tag = text === DEFAULT_REPLY ? "[DEFAULT]" : "";
        console.log(
          `${String(Date.now() - t).padStart(6)}ms ${res.candidates?.[0]?.finishReason} ${tag}\n  Q: ${q}\n  A: ${text}`,
        );
      } catch (err) {
        console.log(`${String(Date.now() - t).padStart(6)}ms ERROR\n  Q: ${q}\n  ${(err as Error).message.slice(0, 200)}`);
      }
    }
    console.log();
  }
}

main();
