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

## แจ้งเตือนแอดมิน (เมื่อบอทตอบ default)

เมื่อบอทตอบลูกค้าด้วยข้อความ default บอทจะแจ้งแอดมิน 2 ทาง ทั้งสองทางเป็นทางเลือก ถ้าไม่ตั้ง env ของทางไหน ทางนั้นจะถูกข้ามไป

**1. กลุ่ม LINE ของแอดมิน** (`ADMIN_LINE_GROUP_ID`)
1. LINE Official Account Manager → Settings → Account settings → เปิด "Allow account to join groups and multi-person chats"
2. สร้างกลุ่ม LINE ของแอดมิน แล้วเชิญ OA เข้ากลุ่ม บอทจะตอบ Group ID (ขึ้นต้นด้วย `C`) ในกลุ่ม
3. นำไปใส่ใน Vercel → `ADMIN_LINE_GROUP_ID` แล้ว Redeploy

แจ้งลูกค้าแต่ละคนไม่เกิน 1 ครั้งต่อ 10 นาที การแจ้งแต่ละครั้งนับเป็น push message ในโควตารายเดือนของ OA บอทตอบเฉพาะแชท 1:1 จะไม่ตอบข้อความในกลุ่ม

**2. Google Sheet "Unanswered"** (`UNANSWERED_SHEET_URL`, `UNANSWERED_SHEET_SECRET`)
บันทึกทุกคำถามที่ตอบไม่ได้ เพื่อนำไปเติม FAQ ขั้นตอนอยู่ใน [scripts/unanswered-sheet.gs](scripts/unanswered-sheet.gs)
ให้ใช้ **คนละไฟล์** กับ FAQ Sheet ที่ Publish to web ไว้ เพราะคำถามของลูกค้าไม่ควรเป็นข้อมูลสาธารณะ

สาเหตุที่จะเห็นในข้อความแจ้งเตือน:
- `not_in_faq` FAQ ไม่มีคำตอบ ให้เพิ่มแถวใน Sheet
- `timeout` / `error` / `incomplete` / `sheet_unavailable` ระบบมีปัญหา ลูกค้าอาจถามเรื่องที่มีใน FAQ อยู่แล้ว

ให้แอดมินตอบลูกค้าต่อได้: LINE OA Manager → Settings → Response settings → เปิด **Chat** คู่กับ **Webhook**
