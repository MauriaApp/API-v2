import { DailyMenu } from "../../../types/lacatho";
import { parseMenuPdf } from "../utils/menu-pdf-parser";

const MENU_PAGE_URL = "https://all-lacatho.fr/fr/menu-jour";

/**
 * Fallback asset id, used when the "menu du jour" page markup can't be parsed.
 * The page embeds the PDF through a Directus asset whose id has been stable for
 * a long time (the file behind it is replaced daily, the id is not).
 */
const FALLBACK_PDF_URL =
    "https://rabbit-api.all-lacatho.fr/assets/69a42435-871a-46a9-9f90-d113d3115621";

const CACHE_TTL_MS = 30 * 60 * 1000;

let cache: { data: DailyMenu; fetchedAt: number } | null = null;

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";

/** Scrape the current PDF url from the menu-jour page (Next.js RSC payload). */
async function resolvePdfUrl(): Promise<string> {
    try {
        const res = await fetch(MENU_PAGE_URL, {
            headers: { "User-Agent": USER_AGENT },
        });
        if (!res.ok) return FALLBACK_PDF_URL;
        const html = await res.text();
        const match = html.match(
            /(https:\/\/rabbit-api\.all-lacatho\.fr\/assets\/[0-9a-f-]{36})/i
        );
        return match?.[1] ?? FALLBACK_PDF_URL;
    } catch {
        return FALLBACK_PDF_URL;
    }
}

async function fetchDailyMenu(): Promise<DailyMenu> {
    const pdfUrl = await resolvePdfUrl();
    const res = await fetch(pdfUrl, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
        throw new Error(`PDF download failed (HTTP ${res.status})`);
    }
    const buffer = await res.arrayBuffer();
    return parseMenuPdf(buffer, pdfUrl);
}

export async function getDailyMenu(): Promise<DailyMenu> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.data;
    }
    try {
        const data = await fetchDailyMenu();
        cache = { data, fetchedAt: Date.now() };
        return data;
    } catch (error) {
        // Serve a stale copy rather than failing if the source is briefly down.
        if (cache) return cache.data;
        throw error;
    }
}
