import { DailyMenu, MenuSection, RestaurantMenu } from "../../../types/lacatho";

/**
 * Menu du CastelRU (seul RU de Châteauroux), scrappé depuis le site du Crous
 * Orléans-Tours. La page publie une liste de blocs `.menu`, un par jour ouvré,
 * chacun contenant un repas (`.meal`) avec des rubriques (Entrées, Plats,
 * Laitage, Desserts) sous forme de listes imbriquées.
 *
 * Le markup est stable et propre : on le reconstruit à la regex, sans dépendance
 * HTML supplémentaire.
 */

const MENU_PAGE_URL =
    "https://www.crous-orleans-tours.fr/restaurant/le-castelru/";

const CACHE_TTL_MS = 30 * 60 * 1000;

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";

const MONTHS = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
];

let cache: { data: DailyMenu; fetchedAt: number } | null = null;

const stripTags = (s: string) => {
    // Répété jusqu'à stabilité : une seule passe laisserait passer des balises
    // imbriquées type "<<span>span>".
    let previous: string;
    let current = s;
    do {
        previous = current;
        current = current.replace(/<[^>]*>/g, "");
    } while (current !== previous);
    return current.trim();
};

const ENTITIES: Record<string, string> = {
    "&rsquo;": "’",
    "&#8217;": "’",
    "&#39;": "’",
    "&lsquo;": "‘",
    "&nbsp;": " ",
    "&eacute;": "é",
    "&egrave;": "è",
    "&agrave;": "à",
    "&ecirc;": "ê",
    "&ocirc;": "ô",
    "&ccedil;": "ç",
    "&quot;": '"',
    "&amp;": "&",
};

// Une seule passe : `&amp;` est traité en même temps que les autres, donc
// jamais re-décodé (pas de double-unescaping).
const decodeEntities = (s: string) =>
    s.replace(
        /&(?:rsquo|lsquo|nbsp|eacute|egrave|agrave|ecirc|ocirc|ccedil|quot|amp|#8217|#39);/g,
        (match) => ENTITIES[match] ?? match
    );

const clean = (s: string) =>
    decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();

/** "Menu du mercredi 9 septembre 2026" -> { day, month (1-12), year } */
function parseMenuDate(
    label: string
): { day: number; month: number; year: number } | null {
    const m = label.toLowerCase().match(/(\d{1,2})\s+([a-zéûôàè]+)\s+(\d{4})/);
    if (!m || !m[1] || !m[2] || !m[3]) return null;
    const month = MONTHS.indexOf(m[2]) + 1;
    if (!month) return null;
    return { day: Number(m[1]), month, year: Number(m[3]) };
}

/** Reconstruit les rubriques d'un bloc `.meal_foodies`. */
function parseFoodies(html: string): MenuSection[] {
    const sections: MenuSection[] = [];
    // Chaque rubrique = <li>Titre<ul><li>item</li>...</ul></li>
    const liRegex = /<li>\s*([^<]+?)\s*<ul>([\s\S]*?)<\/ul>\s*<\/li>/g;
    let match: RegExpExecArray | null;
    while ((match = liRegex.exec(html)) !== null) {
        const title = clean(match[1] ?? "");
        const items = [...(match[2] ?? "").matchAll(/<li>([\s\S]*?)<\/li>/g)]
            .map((i) => clean(i[1] ?? ""))
            .filter(Boolean);
        if (title && items.length) sections.push({ title, items });
    }
    return sections;
}

function parseCastelRuMenu(html: string): DailyMenu {
    const now = new Date();
    const today = {
        day: now.getDate(),
        month: now.getMonth() + 1,
        year: now.getFullYear(),
    };

    // Un segment par jour. Le dernier segment traîne du markup de pied de page,
    // sans conséquence : les regexes de rubriques ne matchent que le menu.
    const segments = html.split('<div class="menu">').slice(1);

    const blocks = segments.map((segment) => {
        const label = clean(
            segment.match(/<time class="menu_date_title">([\s\S]*?)<\/time>/)?.[1] ??
                ""
        );
        const parsed = parseMenuDate(label);
        const isToday =
            !!parsed &&
            parsed.day === today.day &&
            parsed.month === today.month &&
            parsed.year === today.year;
        return { label, segment, isToday };
    });

    // Le menu du jour, sinon le prochain jour publié (premier segment).
    const chosen = blocks.find((b) => b.isToday) ?? blocks[0];
    if (!chosen) {
        return { date: "", pdfUrl: MENU_PAGE_URL, restaurants: [] };
    }

    const sections = parseFoodies(chosen.segment);
    const restaurants: RestaurantMenu[] =
        sections.length > 0
            ? [{ id: "castelru", name: "Le Castel'RU", page: 1, sections }]
            : [];

    return {
        date: chosen.label.replace(/^menu du\s+/i, ""),
        pdfUrl: MENU_PAGE_URL,
        restaurants,
    };
}

async function fetchCastelRuMenu(): Promise<DailyMenu> {
    const res = await fetch(MENU_PAGE_URL, {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
        throw new Error(`CastelRU page download failed (HTTP ${res.status})`);
    }
    return parseCastelRuMenu(await res.text());
}

export async function getCastelRuMenu(): Promise<DailyMenu> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
        return cache.data;
    }
    try {
        const data = await fetchCastelRuMenu();
        cache = { data, fetchedAt: Date.now() };
        return data;
    } catch (error) {
        if (cache) return cache.data;
        throw error;
    }
}
