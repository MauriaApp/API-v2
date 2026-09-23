import { SessionManager } from "../utils/session-manager";
import { PageParser } from "../utils/page-parser";

export type DocumentCategory = {
    menuid: string;
    label: string;
};

export type DownloadType = "datagrid" | "select" | "consulter";

export type AurionDocumentEntry = {
    label: string;
    type: string;
    size: string;
    comment: string;
    category: string;
    docIndex: number;
    downloadType: DownloadType;
    // datagrid & consulter: the submit param that triggers the download
    submitParam: string;
    // select: the select field name, the option value, the download button
    selectName?: string;
    optionValue?: string;
    downloadButtonParam?: string;
    // consulter: the button param to reach the detail page
    consulterParam?: string;
};

export type DocumentsResult = {
    categories: DocumentCategory[];
    documents: AurionDocumentEntry[];
};

const BASE = "https://aurion.junia.com";
const DOC_SUBMENU_ID = "1328656";

// Sidebar entries that are always present but not document leaves.
const NON_LEAF_IDS = new Set(["0", "6"]);

// --- Parsing helpers ---

function parsePartialViewState(body: string): string {
    return (
        body.match(
            /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]><\/update>/
        )?.[1] ?? ""
    );
}

function parseSubmenuCommandId(body: string): string {
    return (
        body.match(
            /PrimeFaces\.ab\(\{s:"([^"]+)"[^)]*u:"form:sidebar"/
        )?.[1] ?? "form:j_idt52"
    );
}

type MenuEntry = { id: string; label: string; kind: "item" | "submenu" };

function parseSidebarEntries(body: string): MenuEntry[] {
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

/**
 * Type A — DataGrid: direct download links with `troncature-download-doc`.
 * Used by "Mes documents utiles" and "Mes bulletins".
 */
function parseDataGridDocuments(
    html: string,
    category: string
): AurionDocumentEntry[] {
    const docs: AurionDocumentEntry[] = [];
    const linkRe =
        /addSubmitParam\('form',\{'([^']+)':'[^']*'\}\)\.submit\('form'\)[\s\S]{0,600}?<div class="[^"]*troncature-download-doc[^"]*">([^<]+)<\/div>/g;

    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
        const submitParam = m[1];
        const label = m[2]?.trim();
        if (!submitParam || !label) continue;
        const docIndex = parseInt(submitParam.split(":")[2] ?? "0", 10);

        const after = html.slice(m.index, m.index + 4000);
        const cells = [
            ...after.matchAll(
                /<td role="gridcell" class="ui-panelgrid-cell">([^<]*)<\/td>/g
            ),
        ].map((c) => c[1]?.trim());

        docs.push({
            label,
            type: cells[5] ?? "",
            size: cells[6] ?? "",
            comment: cells[7] ?? "",
            category,
            docIndex,
            downloadType: "datagrid",
            submitParam,
        });
    }
    return docs;
}

/**
 * Type B — SelectOneMenu: a dropdown of PDF options + a single download
 * button.  Used by "Plan du Campus Lille".
 */
function parseSelectDocuments(
    html: string,
    category: string
): AurionDocumentEntry[] {
    const docs: AurionDocumentEntry[] = [];

    // Find the select with its options.
    const selectMatch = html.match(
        /<select[^>]*name="(form:[^"]+documents_input)"[^>]*>([\s\S]*?)<\/select>/
    );
    if (!selectMatch) return docs;

    const selectName = selectMatch[1];
    const options = selectMatch[2];
    if (!selectName || options === undefined) return docs;
    const optionRe = /<option value="(\d+)">([^<]+)<\/option>/g;
    let opt: RegExpExecArray | null;

    // Find the download button param (the <a> with title="Télécharger"
    // whose onclick has addSubmitParam).  Attribute order varies, so we
    // match onclick first then look for title nearby.
    const dlButtonMatch = html.match(
        /<a[^>]*onclick="PrimeFaces\.addSubmitParam\('form',\{'([^']+)':'[^']*'\}\)\.submit\('form'\)[^"]*"[^>]*title="Télécharger"/
    );
    if (!dlButtonMatch) return docs;
    const downloadButtonParam = dlButtonMatch[1];
    if (!downloadButtonParam) return docs;

    let idx = 0;
    while ((opt = optionRe.exec(options)) !== null) {
        const optionValue = opt[1];
        const label = opt[2]?.trim();
        if (optionValue === undefined || !label) continue;
        docs.push({
            label,
            type: "",
            size: "",
            comment: "",
            category,
            docIndex: idx,
            downloadType: "select",
            submitParam: "",
            selectName,
            optionValue,
            downloadButtonParam,
        });
        idx++;
    }
    return docs;
}

/**
 * Type C — DataTable with "Consulter" buttons: each row leads to a detail
 * page that contains a single downloadable document.  Used by "Mon
 * certificat de scolarité".
 */
function parseConsulterRows(
    html: string
): { consulterParam: string; rowLabel: string }[] {
    const rows: { consulterParam: string; rowLabel: string }[] = [];
    const buttonRe =
        /<button[^>]*name="(form:j_idt\d+:\d+:j_idt\d+)"[^>]*>[\s\S]*?Consulter<\/span><\/button>/g;
    let m: RegExpExecArray | null;
    while ((m = buttonRe.exec(html)) !== null) {
        const consulterParam = m[1];
        if (!consulterParam) continue;
        // Search backwards from the button for the inscription label.
        const before = html.slice(Math.max(0, m.index - 2000), m.index);
        const spans = [
            ...before.matchAll(
                /<span class="preformatted [^"]*">([^<]+)<\/span>/g
            ),
        ];
        const tds = [...before.matchAll(/<td[^>]*>([^<]{2,})<\/td>/g)];
        const rowLabel =
            spans[spans.length - 1]?.[1]?.trim() ||
            tds[tds.length - 1]?.[1]?.trim() ||
            "Document";
        rows.push({ consulterParam, rowLabel });
    }
    return rows;
}

/**
 * Parse a single download link from a detail page (reached after clicking
 * "Consulter").  The detail page has a DataGrid with one document.
 */
function parseDetailPageDocument(
    html: string,
    category: string,
    fallbackLabel: string
): AurionDocumentEntry | null {
    const docs = parseDataGridDocuments(html, category);
    const first = docs[0];
    if (first) {
        return {
            ...first,
            label: fallbackLabel || first.label,
            downloadType: "consulter",
        };
    }
    return null;
}

function parseFormAction(html: string): string {
    const match = html.match(/<form[^>]*id="form"[^>]*action="([^"]+)"/);
    return match?.[1]
        ? new URL(match[1], BASE).toString()
        : `${BASE}/faces/ChoixGmcc.xhtml`;
}

function extractHiddenInputs(html: string): URLSearchParams {
    const fields = new URLSearchParams();
    for (const m of html.matchAll(
        /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
    )) {
        if (m[1] && !m[1].endsWith(":filter")) {
            fields.append(m[1], m[2] ?? "");
        }
    }
    return fields;
}

// --- Scraper ---

export class AurionDocuments {
    private sessionManager: SessionManager;
    private viewState = "";
    private idInit = "";
    private submenuCommandId = "";

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    private async initializeSession() {
        const homeState = await this.sessionManager.fetchHomePageState();
        this.idInit = homeState.idInit;
        this.viewState = homeState.viewState;
    }

    /** Open the "Mes Documents" submenu, return the partial AJAX body. */
    private async openDocsSubmenu(): Promise<string> {
        const menuPage = await this.sessionManager.client.get(
            `${BASE}/faces/MainMenuPage.xhtml`,
            { headers: { Referer: `${BASE}/` }, responseType: "text" }
        );
        this.viewState =
            PageParser.parseViewState(menuPage.body) || this.viewState;
        this.submenuCommandId = parseSubmenuCommandId(menuPage.body);

        const ajax = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": this.submenuCommandId,
            "javax.faces.partial.execute": this.submenuCommandId,
            "javax.faces.partial.render": "form:sidebar",
            [this.submenuCommandId]: this.submenuCommandId,
            "webscolaapp.Sidebar.ID_SUBMENU": DOC_SUBMENU_ID,
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": this.idInit,
            "form:sauvegarde": "",
            "javax.faces.ViewState": this.viewState,
        }).toString();

        const res = await this.sessionManager.client.post(
            `${BASE}/faces/MainMenuPage.xhtml`,
            { body: ajax, responseType: "text" }
        );
        this.viewState = parsePartialViewState(res.body) || this.viewState;
        return res.body;
    }

    /** Click a leaf menuid, follow redirects, return the final page HTML. */
    private async openLeaf(menuid: string): Promise<string> {
        // ViewStates are single-use: reload the submenu before each leaf.
        await this.openDocsSubmenu();

        const payload = new URLSearchParams({
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": this.idInit,
            "form:sauvegarde": "",
            "javax.faces.ViewState": this.viewState,
            "form:sidebar": "form:sidebar",
            "form:sidebar_menuid": menuid,
        }).toString();

        const post = await this.sessionManager.client.post(
            `${BASE}/faces/MainMenuPage.xhtml`,
            { body: payload, responseType: "text" }
        );

        const target = post.headers.location
            ? new URL(post.headers.location, BASE).toString()
            : `${BASE}/faces/ChoixGmcc.xhtml`;

        return this.followTo(target, `${BASE}/faces/MainMenuPage.xhtml`);
    }

    private async followTo(
        url: string,
        referer: string,
        depth = 0
    ): Promise<string> {
        if (depth > 5) return "";
        const res = await this.sessionManager.client.get(url, {
            headers: { Referer: referer },
            responseType: "text",
        });
        if (res.statusCode === 302 && res.headers.location) {
            return this.followTo(
                new URL(res.headers.location, url).toString(),
                url,
                depth + 1
            );
        }
        const vs = PageParser.parseViewState(res.body);
        if (vs) this.viewState = vs;
        return res.body;
    }

    /**
     * Discover document leaves dynamically from the "Mes Documents" submenu,
     * then parse each leaf according to its structure type.  Leaves with no
     * downloadable documents are silently skipped.
     */
    async getAllDocuments(
        email: string,
        password: string
    ): Promise<DocumentsResult> {
        return this.sessionManager.run(email, password, async () => {
            await this.initializeSession();

            // Discover the leaves.
            const submenuBody = await this.openDocsSubmenu();
            const entries = parseSidebarEntries(submenuBody);
            const leaves: DocumentCategory[] = entries
                .filter(
                    (e) => e.kind === "item" && !NON_LEAF_IDS.has(e.id)
                )
                .map((e) => ({ menuid: e.id, label: e.label }));

            // An empty submenu means it did not open — most likely a stale
            // session. Throw so `run` retries with a fresh login instead of
            // silently returning an empty document list.
            if (leaves.length === 0) {
                throw new Error("Aucune catégorie de documents trouvée");
            }

            const categories: DocumentCategory[] = [];
            const documents: AurionDocumentEntry[] = [];

            for (const leaf of leaves) {
                const html = await this.openLeaf(leaf.menuid);

                // Type A: DataGrid with troncature-download-doc
                const gridDocs = parseDataGridDocuments(html, leaf.menuid);
                if (gridDocs.length > 0) {
                    categories.push(leaf);
                    documents.push(...gridDocs);
                    continue;
                }

                // Type B: SelectOneMenu with documents_input
                const selectDocs = parseSelectDocuments(html, leaf.menuid);
                if (selectDocs.length > 0) {
                    categories.push(leaf);
                    documents.push(...selectDocs);
                    continue;
                }

                // Type C: DataTable with "Consulter" buttons
                const consulterRows = parseConsulterRows(html);
                if (consulterRows.length > 0) {
                    categories.push(leaf);
                    for (const row of consulterRows) {
                        // Click "Consulter" to reach the detail page.
                        const detailHtml = await this.openConsulterDetail(
                            html,
                            row.consulterParam
                        );
                        const doc = parseDetailPageDocument(
                            detailHtml,
                            leaf.menuid,
                            row.rowLabel
                        );
                        if (doc) {
                            doc.consulterParam = row.consulterParam;
                            documents.push(doc);
                        }
                    }
                    continue;
                }

                // No downloadable documents on this leaf — skip it.
            }

            return { categories, documents };
        });
    }

    /**
     * Click a "Consulter" button on a leaf page and follow the redirect
     * to the detail page that contains the actual download link.
     */
    private async openConsulterDetail(
        leafHtml: string,
        consulterParam: string
    ): Promise<string> {
        const viewState = PageParser.parseViewState(leafHtml);
        const formAction = parseFormAction(leafHtml);

        const fields = extractHiddenInputs(leafHtml);
        fields.set(consulterParam, consulterParam);
        fields.set("javax.faces.ViewState", viewState);

        const post = await this.sessionManager.client.post(formAction, {
            body: fields.toString(),
            responseType: "text",
        });

        if (post.statusCode === 302 && post.headers.location) {
            const target = new URL(post.headers.location, BASE).toString();
            return this.followTo(target, formAction);
        }
        return post.body;
    }

    /**
     * Download a single document.  Re-walks the navigation chain, then
     * triggers the download according to the document's type.
     */
    async downloadDocument(
        email: string,
        password: string,
        category: string,
        docIndex: number,
        downloadType: DownloadType,
        submitParam: string,
        selectName?: string,
        optionValue?: string,
        downloadButtonParam?: string,
        consulterParam?: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        return this.sessionManager.run(email, password, async () => {
            await this.initializeSession();

            const html = await this.openLeaf(category);

            if (downloadType === "datagrid") {
                return this.downloadDataGrid(html, submitParam);
            }

            if (downloadType === "select") {
                return this.downloadSelect(
                    html,
                    selectName ?? "",
                    optionValue ?? "",
                    downloadButtonParam ?? ""
                );
            }

            // consulter
            return this.downloadConsulter(
                html,
                consulterParam ?? "",
                submitParam
            );
        });
    }

    private async downloadDataGrid(
        html: string,
        submitParam: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        const viewState = PageParser.parseViewState(html);
        const formAction = parseFormAction(html);

        // Recover the filename from the grid.
        const linkRe =
            /addSubmitParam\('form',\{'([^']+)':'[^']*'\}\)\.submit\('form'\)[\s\S]{0,600}?<div class="[^"]*troncature-download-doc[^"]*">([^<]+)<\/div>/g;
        let filename = "";
        let m: RegExpExecArray | null;
        while ((m = linkRe.exec(html)) !== null) {
            if (m[1] === submitParam) {
                filename = m[2]?.trim() ?? "";
                break;
            }
        }

        const fields = extractHiddenInputs(html);
        fields.set(submitParam, submitParam);
        fields.set("javax.faces.ViewState", viewState);

        return this.fetchDownload(formAction, fields, filename);
    }

    private async downloadSelect(
        html: string,
        selectName: string,
        optionValue: string,
        downloadButtonParam: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        const viewState = PageParser.parseViewState(html);
        const formAction = parseFormAction(html);

        // Recover the filename from the matching <option>.
        const filename =
            html.match(
                new RegExp(`<option value="${optionValue}">([^<]+)</option>`)
            )?.[1]?.trim() ?? "document.pdf";

        const fields = extractHiddenInputs(html);
        fields.set(selectName, optionValue);
        fields.set(downloadButtonParam, downloadButtonParam);
        fields.set("javax.faces.ViewState", viewState);

        return this.fetchDownload(formAction, fields, filename);
    }

    private async downloadConsulter(
        leafHtml: string,
        consulterParam: string,
        submitParam: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        // Step 1: click "Consulter" to reach the detail page.
        const detailHtml = await this.openConsulterDetail(
            leafHtml,
            consulterParam
        );

        // Step 2: download from the detail page (same as datagrid).
        return this.downloadDataGrid(detailHtml, submitParam);
    }

    private async fetchDownload(
        formAction: string,
        fields: URLSearchParams,
        fallbackFilename: string
    ): Promise<{ buffer: Buffer; filename: string }> {
        const dl = await this.sessionManager.client.post(formAction, {
            body: fields.toString(),
            responseType: "buffer",
        });

        if (dl.statusCode !== 200 || dl.body.length === 0) {
            throw new Error(`Échec du téléchargement (HTTP ${dl.statusCode})`);
        }

        const cd = dl.headers["content-disposition"] as string | undefined;
        const cdFilename = cd?.match(/filename="([^"]+)"/)?.[1];
        return {
            buffer: dl.body,
            filename: cdFilename || fallbackFilename,
        };
    }
}
