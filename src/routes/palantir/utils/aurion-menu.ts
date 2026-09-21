/**
 * Menu navigation for "Les plannings > Plannings Groupés par Promotion".
 *
 * Kept apart from routes/aurion/utils/page-parser.ts on purpose: that parser
 * serves the student's *own* pages and is already fragile enough. Palantir
 * walks a different, deeper part of Aurion (a lazy-loaded sidebar tree and a
 * paginated selection DataTable), so it carries its own extraction rather
 * than widening the shared one.
 */

import { SessionManager } from "../../aurion/utils/session-manager";

export const BASE = "https://aurion.junia.com";

/** "Les plannings" then "Plannings Groupés par Promotion". */
export const ROOT_CHAIN = ["3131476", "7465293"];

export type Session = InstanceType<typeof SessionManager>;

/**
 * A harvest is hundreds of calls long, and Aurion does occasionally leave a
 * socket open without ever answering. The shared SessionManager sets no
 * timeout — fine for a single user-facing request, fatal here, where one stuck
 * call would wedge the whole weekly build forever. So Palantir builds its
 * sessions through this wrapper instead of touching the shared client.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export function newSession(): Session {
    const session = new SessionManager();
    // extend() widens the client's option type, but the instance is the same
    // got client with the same defaults plus a timeout.
    session.client = session.client.extend({
        timeout: { request: REQUEST_TIMEOUT_MS },
        retry: { limit: 1 },
    }) as unknown as typeof session.client;
    return session;
}

export interface MenuEntry {
    id: string;
    label: string;
    kind: "item" | "submenu";
}

export interface MenuPage {
    body: string;
    viewState: string;
    idInit: string;
    /** Source id of the p:remoteCommand that lazy-loads a submenu. */
    commandId: string;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sidebar entries, of two kinds: leaves submit a "sidebar_menuid", parents
 * lazy-load their children through their "submenu_<id>" class.
 */
export function parseSidebarEntries(body: string): MenuEntry[] {
    const entries: MenuEntry[] = [];
    const seen = new Set<string>();

    const push = (id: string, label: string, kind: MenuEntry["kind"]) => {
        const key = `${kind}:${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ id, label: label.trim(), kind });
    };

    const leaf =
        /'form:sidebar_menuid':'([\w_]+)'[\s\S]{0,400}?<span class="ui-menuitem-text">([^<]+)<\/span>/g;
    for (const m of body.matchAll(leaf)) {
        if (m[1] && m[2]) push(m[1], m[2], "item");
    }

    const parent =
        /submenu_(\d+)[\s\S]{0,300}?<span class="ui-menuitem-text">([^<]+)<\/span>/g;
    for (const m of body.matchAll(parent)) {
        if (m[1] && m[2]) push(m[1], m[2], "submenu");
    }

    return entries;
}

export const parseViewState = (body: string): string =>
    body.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1] ?? "";

export const parseIdInit = (body: string): string =>
    body.match(/name="form:idInit" value="([^"]+)"/)?.[1] ?? "";

export const parseSubmenuCommandId = (body: string): string =>
    body.match(/PrimeFaces\.ab\(\{s:"([^"]+)"[^)]*u:"form:sidebar"/)?.[1] ??
    "form:j_idt52";

/** Partial responses carry a refreshed ViewState to use for the next call. */
export const parsePartialViewState = (body: string): string =>
    body.match(
        /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]><\/update>/
    )?.[1] ?? "";

/** Every `<input name=… value=…>` of a form, minus the filter fields. */
export function formFields(body: string): URLSearchParams {
    const fields = new URLSearchParams();
    for (const m of body.matchAll(
        /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
    )) {
        const [, name, value] = m;
        if (name && !name.endsWith(":filter")) fields.append(name, value ?? "");
    }
    return fields;
}

/** A freshly loaded MainMenuPage: the menu state lives on the server. */
export async function openMenu(session: Session): Promise<MenuPage> {
    await session.client.get(`${BASE}/`, { responseType: "text" });
    const page = await session.client.get(`${BASE}/faces/MainMenuPage.xhtml`, {
        headers: { Referer: `${BASE}/` },
        responseType: "text",
    });
    return {
        body: page.body,
        viewState: parseViewState(page.body),
        idInit: parseIdInit(page.body),
        commandId: parseSubmenuCommandId(page.body),
    };
}

/**
 * Expand the nodes of `chain` in order. A nested node throws a
 * NullPointerException unless its parent was expanded first, and each partial
 * response carries the ViewState the next call has to use.
 */
export async function expand(
    session: Session,
    menu: MenuPage,
    chain: string[],
    delayMs: number
): Promise<{ body: string; viewState: string }> {
    let viewState = menu.viewState;
    let body = menu.body;

    for (const node of chain) {
        const ajax = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": menu.commandId,
            "javax.faces.partial.execute": menu.commandId,
            "javax.faces.partial.render": "form:sidebar",
            [menu.commandId]: menu.commandId,
            "webscolaapp.Sidebar.ID_SUBMENU": node,
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": menu.idInit,
            "form:sauvegarde": "",
            "javax.faces.ViewState": viewState,
        });

        const res = await session.client.post(
            `${BASE}/faces/MainMenuPage.xhtml`,
            { body: ajax.toString(), responseType: "text" }
        );
        if (res.body.includes("<error-name>")) {
            throw new Error(
                `sous-menu ${node} : ${res.body.match(/<error-name>([^<]+)/)?.[1]}`
            );
        }
        viewState = parsePartialViewState(res.body) || viewState;
        body = res.body;
        await sleep(delayMs);
    }

    return { body, viewState };
}

/**
 * Open a planning leaf and land on its group-selection screen. Aurion answers
 * the menu POST with a 302, so the target is read off the Location header.
 */
export async function openLeaf(
    session: Session,
    menu: MenuPage,
    viewState: string,
    menuid: string
): Promise<{ url: string; body: string }> {
    const payload = new URLSearchParams({
        form: "form",
        "form:largeurDivCenter": "885",
        "form:idInit": menu.idInit,
        "form:sauvegarde": "",
        "javax.faces.ViewState": viewState,
        "form:sidebar": "form:sidebar",
        "form:sidebar_menuid": menuid,
    });
    const posted = await session.client.post(
        `${BASE}/faces/MainMenuPage.xhtml`,
        { body: payload.toString(), responseType: "text" }
    );
    const url = posted.headers.location
        ? new URL(posted.headers.location, BASE).toString()
        : `${BASE}/faces/ChoixPlanning.xhtml`;
    const page = await session.client.get(url, {
        headers: { Referer: `${BASE}/faces/MainMenuPage.xhtml` },
        responseType: "text",
    });
    return { url, body: page.body };
}
