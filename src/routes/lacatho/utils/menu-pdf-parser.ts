import { getDocumentProxy } from "unpdf";
import { DailyMenu, MenuSection, RestaurantMenu } from "../../../types/lacatho";

/**
 * The "menu du jour" PDF on all-lacatho.fr is a single A3 document with one page
 * per restaurant (pages 1-5) plus an allergen table (page 6, ignored).
 *
 * Pages 1-4 use a two-column layout: the section label sits in its own left
 * column, vertically centred on its group of dishes. Page 5 ("Sandwicherie")
 * uses a single centred column with each label directly above its dishes.
 *
 * There is no machine-readable structure in the PDF, so we reconstruct the
 * sections from the x/y position of every text run. No OCR is involved – the
 * text layer is clean.
 */

const RESTAURANTS: { id: string; name: string }[] = [
    { id: "food-corner", name: "Food Corner" },
    { id: "globe-trotter", name: "Globe Trotter" },
    { id: "green", name: "Green" },
    { id: "tradi", name: "Tradi" },
    { id: "sandwicherie", name: "Sandwicherie" },
];

const SECTION_LABELS: Record<string, string> = {
    ENTREE: "Entrées",
    ENTREES: "Entrées",
    PLAT: "Plats",
    PLATS: "Plats",
    ACCOMPAGNEMENT: "Accompagnements",
    ACCOMPAGNEMENTS: "Accompagnements",
    DESSERT: "Desserts",
    DESSERTS: "Desserts",
    SANDWICH: "Sandwichs",
    SANDWICHS: "Sandwichs",
    CIABATTA: "Ciabattas",
    CIABATTAS: "Ciabattas",
    "PLAT CHAUD": "Plats chauds",
    "PLATS CHAUDS": "Plats chauds",
    SALADE: "Salades",
    SALADES: "Salades",
};

const DAYS = "lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche";
const DAY_RE = new RegExp(`^(${DAYS})\\b`, "i");

const NOISE: RegExp[] = [
    /^menu du jour$/i,
    DAY_RE,
    /^pour retrouver toutes/i,
    /^(internet\s*:\s*)?all-?\s*$/i,
    /^lacatho\.fr$/i,
    /^all-lacatho\.fr$/i,
    /^internet\s*:\s*all-lacatho\.fr$/i,
    /^horaires,? menus/i,
    /^click ?& ?collect/i,
    /^www\.all-lacatho\.fr$/i,
    /^tarif passager/i,
    /^formule etudiante$/i,
    /^1 plat \+ 2 peripheriques/i,
    /^\d+\s*€$/,
];

const stripAccents = (s: string): string =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string): string =>
    stripAccents(s).toUpperCase().replace(/\s+/g, " ").trim();
const isNoise = (s: string): boolean => {
    const a = stripAccents(s).trim();
    return NOISE.some((re) => re.test(a));
};

interface TextRun {
    str: string;
    x: number;
    y: number;
    w: number;
    h: number;
}
interface Row {
    str: string;
    x: number;
    xEnd: number;
    y: number;
    h: number;
}
interface Header {
    y: number;
    x: number;
    title: string;
}

/** Merge glyph runs that share a baseline and are horizontally contiguous. */
function toRows(runs: TextRun[]): Row[] {
    const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Row[] = [];
    for (const it of sorted) {
        const row = rows.find(
            (r) =>
                Math.abs(r.y - it.y) <= 3 &&
                it.x - r.xEnd >= -2 &&
                it.x - r.xEnd < 15
        );
        if (row) {
            row.str += it.str;
            row.xEnd = it.x + it.w;
            row.h = Math.max(row.h, it.h);
        } else {
            rows.push({
                str: it.str,
                x: it.x,
                xEnd: it.x + it.w,
                y: it.y,
                h: it.h,
            });
        }
    }
    return rows.map((r) => ({ ...r, str: r.str.replace(/\s+/g, " ").trim() }));
}

/**
 * Centred layout: every section label sits at the vertical centre of its group.
 * Find the contiguous partition of the (y-descending) dish list whose group
 * mid-points best match the header ys.
 */
function partitionByMidpoint(dishes: Row[], headers: Header[]): Row[][] {
    const n = dishes.length;
    const k = headers.length;
    if (k <= 1 || n === 0) return [dishes];
    if (n < k) return dishes.map((d) => [d]);

    let best: Row[][] | null = null;
    let bestCost = Infinity;

    const rec = (start: number, gi: number, cuts: number[]): void => {
        if (gi === k - 1) {
            const bounds = [...cuts, n];
            const groups: Row[][] = [];
            let cost = 0;
            let s = 0;
            for (let i = 0; i < k; i++) {
                const end = bounds[i] as number;
                const g = dishes.slice(s, end);
                groups.push(g);
                const first = g[0];
                const last = g[g.length - 1];
                if (first && last) {
                    const mid = (first.y + last.y) / 2;
                    const header = headers[i] as Header;
                    cost += (mid - header.y) ** 2;
                }
                s = end;
            }
            if (cost < bestCost) {
                bestCost = cost;
                best = groups;
            }
            return;
        }
        for (let c = start + 1; c <= n - (k - 1 - gi); c++) {
            rec(c, gi + 1, [...cuts, c]);
        }
    };
    rec(0, 0, []);
    return best ?? [dishes];
}

/** Stacked layout: assign each dish to the nearest header above it. */
function partitionByHeaderAbove(dishes: Row[], headers: Header[]): Row[][] {
    const groups: Row[][] = headers.map(() => []);
    for (const d of dishes) {
        let gi = 0;
        for (let i = 0; i < headers.length; i++) {
            if ((headers[i] as Header).y > d.y) gi = i;
        }
        (groups[gi] as Row[]).push(d);
    }
    return groups;
}

function parsePage(rows: Row[], restaurantName: string): MenuSection[] {
    const headers: Header[] = [];
    const dishes: Row[] = [];

    for (const r of rows) {
        if (!r.str || isNoise(r.str) || r.h >= 38) continue;
        if (norm(r.str) === norm(restaurantName)) continue;

        const label = SECTION_LABELS[norm(r.str)];
        if (label) {
            headers.push({ y: r.y, x: r.x, title: label });
            continue;
        }
        // Fallback: an unknown all-caps run is treated as a section header so a
        // renamed section still shows up.
        if (/^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ' ]{2,20}$/.test(r.str) && r.h >= 15) {
            headers.push({
                y: r.y,
                x: r.x,
                title: r.str[0] + r.str.slice(1).toLowerCase(),
            });
            continue;
        }
        dishes.push(r);
    }

    headers.sort((a, b) => b.y - a.y);
    dishes.sort((a, b) => b.y - a.y);
    if (!headers.length || !dishes.length) return [];

    const maxHeaderX = Math.max(...headers.map((h) => h.x));
    const minDishX = Math.min(...dishes.map((d) => d.x));
    const groups =
        minDishX - maxHeaderX > 120
            ? partitionByMidpoint(dishes, headers)
            : partitionByHeaderAbove(dishes, headers);

    return headers
        .map((h, i) => ({
            title: h.title,
            items: (groups[i] ?? []).map((d) => d.str),
        }))
        .filter((s) => s.items.length > 0);
}

export async function parseMenuPdf(
    pdfBuffer: ArrayBuffer,
    pdfUrl: string
): Promise<DailyMenu> {
    const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
    const pageCount = Math.min(RESTAURANTS.length, pdf.numPages);

    let date = "";
    const restaurants: RestaurantMenu[] = [];

    for (let p = 1; p <= pageCount; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const runs: TextRun[] = [];
        for (const item of content.items) {
            if (!("str" in item) || !item.str.trim()) continue;
            const tx = item.transform;
            const x = tx[4];
            const y = tx[5];
            if (typeof x !== "number" || typeof y !== "number") continue;
            runs.push({
                str: item.str,
                x: Math.round(x),
                y: Math.round(y),
                w: Math.round(item.width),
                h: Math.round(item.height),
            });
        }

        const rows = toRows(runs);
        if (!date) {
            const dateRow = rows.find((r) => DAY_RE.test(stripAccents(r.str)));
            if (dateRow) date = dateRow.str;
        }


        const restaurant = RESTAURANTS[p - 1] as { id: string; name: string };
        restaurants.push({
            id: restaurant.id,
            name: restaurant.name,
            page: p,
            sections: parsePage(rows, restaurant.name),
        });
    }

    return { date, pdfUrl, restaurants };
}
