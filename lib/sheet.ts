import {
  FAQ_CACHE_MS,
  SHEET_TIMEOUT_MS,
  errorMessage,
  getEnv,
  log,
} from "./config";

type FaqCache = { csv: string; fetchedAt: number };

// Module-level cache: survives between requests on a warm Vercel instance.
let cache: FaqCache | null = null;

async function fetchCsv(): Promise<string> {
  const res = await fetch(getEnv("SHEET_CSV_URL"), {
    cache: "no-store",
    signal: AbortSignal.timeout(SHEET_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`sheet_http_${res.status}`);
  }
  const csv = (await res.text()).trim();
  if (!csv) {
    throw new Error("sheet_empty");
  }
  // An /edit or /pubhtml link returns a web page, not the FAQ table.
  // Feeding that HTML to Gemini makes every answer DEFAULT_REPLY, so fail loudly.
  const contentType = res.headers.get("content-type") ?? "";
  if (csv.startsWith("<") || contentType.includes("text/html")) {
    throw new Error(
      `sheet_not_csv: SHEET_CSV_URL returned ${contentType || "HTML"} — use File → Share → Publish to web → CSV (link ends in output=csv)`,
    );
  }
  return csv;
}

/**
 * FAQ CSV from the published Google Sheet, cached in memory for 60s.
 * On fetch failure, falls back to the stale cache; throws only if there is no cache at all.
 */
export async function getFaqCsv(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < FAQ_CACHE_MS) {
    return cache.csv;
  }

  try {
    const csv = await fetchCsv();
    cache = { csv, fetchedAt: Date.now() };
    return csv;
  } catch (err) {
    if (cache) {
      log("warn", "sheet_fetch_failed_using_stale", {
        message: errorMessage(err),
        staleMs: Date.now() - cache.fetchedAt,
      });
      return cache.csv;
    }
    throw err;
  }
}
