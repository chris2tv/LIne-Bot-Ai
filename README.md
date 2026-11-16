# LIne-Bot-Ai — Admin Dink 65 Pickleball Club

LINE bot ที่ตอบลูกค้าในนามแอดมินสนาม Dink 65 Pickleball Club โดยดึง FAQ จาก Google Sheet แล้วให้ Gemini เขียนคำตอบ (รายละเอียดทั้งหมดอยู่ใน [BRIEF-dink65-line-bot.md](BRIEF-dink65-line-bot.md))

## Stack
Next.js 14 (App Router, TypeScript) on Vercel · `@line/bot-sdk` · `@google/genai`

## Files
- `app/api/line-webhook/route.ts` — webhook: verify signature → reply
- `lib/config.ts` — constants (`GEMINI_MODEL`, `DEFAULT_REPLY`, …) + env
- `lib/sheet.ts` — FAQ CSV fetch + 60s cache (stale fallback)
- `lib/prompt.ts` — system prompt
- `lib/gemini.ts` — Gemini call, 7s timeout, finishReason checks, logging
- `vercel.json` — pins `framework: nextjs` so Vercel doesn't mis-detect

## Setup
```bash
npm install
cp .env.example .env.local   # fill in the 4 values
npm run dev                  # GET http://localhost:3000/api/line-webhook → "ok"
npm run build
```

Env vars (set in Vercel → Settings → Environment Variables too):
`LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `GEMINI_API_KEY`, `SHEET_CSV_URL`

Webhook URL in LINE Developers Console: `https://<production-url>/api/line-webhook`
