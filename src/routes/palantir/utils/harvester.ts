/**
 * Harvesting primitives for Palantir: enumerate the promotion plannings, read
 * their group-selection tables, and pull lessons out of the Schedule widget.
 *
 * Aurion is a shared production server and its session state lives server
 * side, so a single session is strictly sequential. Concurrency is obtained
 * by running several independent SessionManagers instead (see runPool).
 */

import {
    BASE,
    MenuPage,
    ROOT_CHAIN,
    Session,
    expand,
    formFields,
    newSession,
    openLeaf,
    openMenu,
    parseSidebarEntries,
    parseViewState,
    sleep,
} from "./aurion-menu";
import {
    PalantirGroup,
    PalantirLesson,
    PalantirPlanningNode,
} from "../../../types/palantir";

/** Politeness delay between two calls of the same worker. */
export const DELAY_MS = 150;

/** Independent Aurion sessions used to harvest in parallel. */
export const WORKERS = 6;

export interface HarvestWindow {
    start: number;
    end: number;
}

/**
 * Walk the promotion tree and list every planning leaf. The sidebar is
 * stateful, so each filière is expanded from a freshly loaded menu and the
 * entries already present before the expansion are subtracted out.
 */
export async function discoverPlannings(
    session: Session
): Promise<PalantirPlanningNode[]> {
    const menu = await openMenu(session);
    const before = new Set(
        parseSidebarEntries(menu.body).map((e) => `${e.kind}:${e.id}`)
    );
    const root = await expand(session, menu, ROOT_CHAIN, DELAY_MS);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) =>
            e.kind === "submenu" &&
            !before.has(`${e.kind}:${e.id}`) &&
            // Expanding the root lists the root itself among its children.
            !ROOT_CHAIN.includes(e.id)
    );

    const nodes: PalantirPlanningNode[] = [];
    for (const filiere of filieres) {
        const fresh = await openMenu(session);
        const seen = new Set(
            parseSidebarEntries(fresh.body).map((e) => `${e.kind}:${e.id}`)
        );
        const opened = await expand(
            session,
            fresh,
            [...ROOT_CHAIN, filiere.id],
            DELAY_MS
        );
        for (const leaf of parseSidebarEntries(opened.body)) {
            if (leaf.kind !== "item") continue;
            if (seen.has(`${leaf.kind}:${leaf.id}`)) continue;
            nodes.push({
                menuid: leaf.id,
                label: leaf.label,
                filiereId: filiere.id,
                filiere: filiere.label,
            });
        }
        await sleep(DELAY_MS);
    }

    return nodes;
}

/**
 * A worker's cached menu page: which filière it can open leaves of, with the
 * ViewState those leaf posts reuse. Verified live (scripts/palantir-menu-reuse.ts):
 * a leaf post neither consumes the ViewState nor disturbs the server-side
 * expansion, so the openMenu+expand preamble is paid once per worker and
 * filière instead of once per planning.
 */
export interface MenuContext {
    menu: MenuPage;
    viewState: string;
    filiereId: string;
}

/** The selection screen is the DataTable with its "Voir planning" button. */
const isChoiceScreen = (body: string) =>
    body.includes('PrimeFaces.cw("DataTable"') &&
    body.includes("Voir planning") &&
    !body.includes("<error-name>");

/** The menu preamble — 5 requests — or the cached one when it still matches. */
async function ensureMenu(
    session: Session,
    ctx: MenuContext | null,
    node: PalantirPlanningNode
): Promise<MenuContext> {
    if (ctx && ctx.filiereId === node.filiereId) return ctx;
    const menu = await openMenu(session);
    const opened = await expand(
        session,
        menu,
        [...ROOT_CHAIN, node.filiereId],
        DELAY_MS
    );
    return { menu, viewState: opened.viewState, filiereId: node.filiereId };
}

/**
 * Open a planning's selection screen through a cached menu context. If the
 * reused page turns out not to work after all (session recycled, Aurion
 * restarted…), pay the preamble again and retry once before giving up.
 */
async function openChoice(
    session: Session,
    ctx: MenuContext,
    node: PalantirPlanningNode
): Promise<{ url: string; body: string; ctx: MenuContext }> {
    const leaf = await openLeaf(session, ctx.menu, ctx.viewState, node.menuid);
    if (isChoiceScreen(leaf.body)) {
        return { url: leaf.url, body: leaf.body, ctx };
    }
    const fresh = await ensureMenu(session, null, node);
    const retry = await openLeaf(
        session,
        fresh.menu,
        fresh.viewState,
        node.menuid
    );
    if (!isChoiceScreen(retry.body)) {
        throw new Error("écran de sélection introuvable");
    }
    return { url: retry.url, body: retry.body, ctx: fresh };
}

const stripTags = (html: string) =>
    html
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();

/**
 * Rows of the selection DataTable. Columns are, in order: selection checkbox,
 * code, libellé, fin de validité, and the kind Aurion itself assigns —
 * "Promotion" for a class, "Planning" for one of its subgroups.
 */
function parseGroupRows(
    body: string,
    node: PalantirPlanningNode
): PalantirGroup[] {
    const rows: PalantirGroup[] = [];
    for (const m of body.matchAll(
        /<tr[^>]*data-rk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g
    )) {
        const rowKey = m[1];
        const cells = [...(m[2] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((c) => stripTags(c[1] ?? ""));
        if (!rowKey) continue;
        rows.push({
            rowKey,
            code: cells[1] ?? "",
            label: cells[2] ?? "",
            type: cells[4] ?? "",
            menuid: node.menuid,
            planningLabel: node.label,
        });
    }
    return rows;
}

/** Follow the DataTable paginator when the promotion has more rows than a page. */
async function readAllGroups(
    session: Session,
    url: string,
    body: string,
    tableId: string,
    node: PalantirPlanningNode
): Promise<PalantirGroup[]> {
    const groups = parseGroupRows(body, node);
    const widget = body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"[^"]+",paginator:\{[^}]*rows:(\d+),rowCount:(\d+)/
    );
    const rows = Number(widget?.[1] ?? 0);
    const rowCount = Number(widget?.[2] ?? groups.length);
    if (!rows || rowCount <= groups.length) return groups;

    for (let first = groups.length; first < rowCount; first += rows) {
        const fields = formFields(body);
        fields.set("javax.faces.partial.ajax", "true");
        fields.set("javax.faces.source", tableId);
        fields.set("javax.faces.partial.execute", tableId);
        fields.set("javax.faces.partial.render", tableId);
        fields.set(`${tableId}_pagination`, "true");
        fields.set(`${tableId}_first`, String(first));
        fields.set(`${tableId}_rows`, String(rows));
        fields.set(`${tableId}_skipChildren`, "true");
        fields.set(`${tableId}_encodeFeature`, "true");
        fields.set("form", "form");
        fields.set("javax.faces.ViewState", parseViewState(body));

        const res = await session.client.post(url, {
            body: fields.toString(),
            responseType: "text",
        });
        const page = parseGroupRows(res.body, node);
        if (!page.length) break;
        groups.push(...page);
        await sleep(DELAY_MS);
    }

    const seen = new Set<string>();
    return groups.filter((g) =>
        seen.has(g.rowKey) ? false : (seen.add(g.rowKey), true)
    );
}

/**
 * Tick `rowKeys` on the selection screen, land on the Schedule, and ask it for
 * the lessons of `window`. The widget takes an arbitrary range, so a single
 * pass can cover several weeks at once.
 */
async function readLessons(
    session: Session,
    choiceUrl: string,
    choiceBody: string,
    tableId: string,
    submitId: string,
    rowKeys: string[],
    window: HarvestWindow
): Promise<PalantirLesson[]> {
    const fields = formFields(choiceBody);
    fields.set("form", "form");
    fields.set(`${tableId}_selection`, rowKeys.join(","));
    fields.set(submitId, submitId);
    fields.set("javax.faces.ViewState", parseViewState(choiceBody));

    const shown = await session.client.post(choiceUrl, {
        body: fields.toString(),
        responseType: "text",
    });
    const planningUrl = shown.headers.location
        ? new URL(shown.headers.location, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    const planning = await session.client.get(planningUrl, {
        headers: { Referer: choiceUrl },
        responseType: "text",
    });
    await sleep(DELAY_MS);

    const scheduleId = planning.body.match(
        /PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    if (!scheduleId) throw new Error("widget Schedule introuvable");

    const ev = formFields(planning.body);
    ev.set("javax.faces.partial.ajax", "true");
    ev.set("javax.faces.source", scheduleId);
    ev.set("javax.faces.partial.execute", scheduleId);
    ev.set("javax.faces.partial.render", scheduleId);
    ev.set(scheduleId, scheduleId);
    ev.set(`${scheduleId}_start`, String(window.start));
    ev.set(`${scheduleId}_end`, String(window.end));
    ev.set(`${scheduleId}_view`, "agendaWeek");
    ev.set("form", "form");
    ev.set("form:offsetFuseauNavigateur", "-7200000");
    ev.set("javax.faces.ViewState", parseViewState(planning.body));

    const res = await session.client.post(planningUrl, {
        body: ev.toString(),
        responseType: "text",
    });
    const json = res.body.match(/\[\{"id"[\s\S]*?\}\]/)?.[0];
    return json ? (JSON.parse(json) as PalantirLesson[]) : [];
}

/** Ids of the selection DataTable and of its "Voir planning" button. */
function parseChoiceIds(body: string) {
    const tableId = body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    const submitId = body.match(
        /<button id="(form:j_idt\d+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Voir planning/
    )?.[1];
    if (!tableId || !submitId) {
        throw new Error("écran de sélection inattendu (DataTable ou bouton)");
    }
    return { tableId, submitId };
}

/**
 * One planning, every group ticked at once: the groups feed the searchable
 * catalogue, the lessons feed the room index. Returns the possibly-refreshed
 * menu context, for the caller to keep chaining leaves with.
 */
export async function harvestPlanning(
    session: Session,
    ctx: MenuContext,
    node: PalantirPlanningNode,
    window: HarvestWindow
): Promise<{
    groups: PalantirGroup[];
    lessons: PalantirLesson[];
    ctx: MenuContext;
}> {
    const choice = await openChoice(session, ctx, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    const groups = await readAllGroups(
        session,
        choice.url,
        choice.body,
        tableId,
        node
    );
    if (!groups.length) return { groups: [], lessons: [], ctx: choice.ctx };

    const lessons = await readLessons(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        groups.map((g) => g.rowKey),
        window
    );
    return { groups, lessons, ctx: choice.ctx };
}

/**
 * A single group's schedule, fetched live. The bulk harvest ticks every group
 * at once and Aurion does not say which group a lesson belongs to, so a group
 * planning cannot be filtered out of the index — it has to be asked for.
 */
export async function fetchGroupLessons(
    session: Session,
    node: PalantirPlanningNode,
    rowKey: string,
    window: HarvestWindow
): Promise<PalantirLesson[]> {
    const ctx = await ensureMenu(session, null, node);
    const choice = await openChoice(session, ctx, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    return readLessons(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        [rowKey],
        window
    );
}

/**
 * Harvest every planning on `workers` independent Aurion sessions. Aurion
 * accepts several concurrent sessions for the same account, and a worker that
 * fails on one planning keeps going with the next.
 *
 * Plannings are handed out as contiguous filière buckets, not one by one: the
 * menu context a worker caches is only good for one filière, so a worker that
 * jumped between filières on every item would pay the preamble again
 * each time and the reuse would be worth nothing. A failed planning drops the
 * context — the next one rebuilds it from a fresh menu.
 */
export async function harvestAll(
    email: string,
    password: string,
    nodes: PalantirPlanningNode[],
    window: HarvestWindow,
    onPlanning: (
        node: PalantirPlanningNode,
        result: { groups: PalantirGroup[]; lessons: PalantirLesson[] } | null,
        error: unknown
    ) => void
): Promise<void> {
    const buckets: PalantirPlanningNode[][] = [];
    for (const node of nodes) {
        const current = buckets[buckets.length - 1];
        if (current?.[0]?.filiereId === node.filiereId) {
            current.push(node);
        } else {
            buckets.push([node]);
        }
    }

    let cursor = 0;
    const run = async () => {
        const session = newSession();
        await session.login(email, password);
        let ctx: MenuContext | null = null;
        for (
            let index = cursor++;
            index < buckets.length;
            index = cursor++
        ) {
            const bucket = buckets[index];
            if (!bucket) continue;
            for (const node of bucket) {
                try {
                    const menu = await ensureMenu(session, ctx, node);
                    const result = await harvestPlanning(
                        session,
                        menu,
                        node,
                        window
                    );
                    ctx = result.ctx;
                    onPlanning(node, result, null);
                } catch (error) {
                    ctx = null;
                    onPlanning(node, null, error);
                }
                await sleep(DELAY_MS);
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(WORKERS, buckets.length) }, () => run())
    );
}
