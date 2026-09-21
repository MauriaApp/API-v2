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

/** Re-open a planning's selection screen from a fresh, correctly expanded menu. */
async function openChoice(
    session: Session,
    node: PalantirPlanningNode
): Promise<{ menu: MenuPage; url: string; body: string }> {
    const menu = await openMenu(session);
    const opened = await expand(
        session,
        menu,
        [...ROOT_CHAIN, node.filiereId],
        DELAY_MS
    );
    const leaf = await openLeaf(session, menu, opened.viewState, node.menuid);
    return { menu, url: leaf.url, body: leaf.body };
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
 * catalogue, the lessons feed the room and teacher index.
 */
export async function harvestPlanning(
    session: Session,
    node: PalantirPlanningNode,
    window: HarvestWindow
): Promise<{ groups: PalantirGroup[]; lessons: PalantirLesson[] }> {
    const choice = await openChoice(session, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    const groups = await readAllGroups(
        session,
        choice.url,
        choice.body,
        tableId,
        node
    );
    if (!groups.length) return { groups: [], lessons: [] };

    const lessons = await readLessons(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        groups.map((g) => g.rowKey),
        window
    );
    return { groups, lessons };
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
    const choice = await openChoice(session, node);
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
 * Run `task` over `items` on `workers` independent Aurion sessions. Aurion
 * accepts several concurrent sessions for the same account, and a worker that
 * fails on one item keeps going with the next.
 */
export async function runPool<T, R>(
    email: string,
    password: string,
    items: T[],
    workers: number,
    task: (session: Session, item: T) => Promise<R>,
    onSettled?: (item: T, result: R | null, error: unknown) => void
): Promise<void> {
    let cursor = 0;
    const next = () => (cursor < items.length ? items[cursor++] : undefined);

    const run = async () => {
        const session = newSession();
        await session.login(email, password);
        for (let item = next(); item !== undefined; item = next()) {
            try {
                const result = await task(session, item);
                onSettled?.(item, result, null);
            } catch (error) {
                onSettled?.(item, null, error);
            }
            await sleep(DELAY_MS);
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(workers, items.length) }, () => run())
    );
}
