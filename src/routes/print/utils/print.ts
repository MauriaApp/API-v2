import { PrintSessionManager, PRINT_BASE } from "./session-manager";

export type PrintFolder = "WAITING" | "PRINTED";

export type PrintJob = {
    id: string;
    name: string;
    date: string;
    owner: string;
};

export type PrintBalance = {
    personal: number;
    bonus: number;
};

// Entités nommées courantes (Latin-1 / HTML4) — les noms de fichiers
// SafeQ encodent les accents ainsi ("&eacute;", "&deg;"…).
const NAMED_ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    euro: "€",
    pound: "£",
    yen: "¥",
    cent: "¢",
    copy: "©",
    reg: "®",
    trade: "™",
    deg: "°",
    micro: "µ",
    middot: "·",
    bull: "•",
    hellip: "…",
    ndash: "–",
    mdash: "—",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
    laquo: "«",
    raquo: "»",
    times: "×",
    divide: "÷",
    sup1: "¹",
    sup2: "²",
    sup3: "³",
    frac12: "½",
    frac14: "¼",
    frac34: "¾",
    nbsp: " ",
    Agrave: "À",
    Aacute: "Á",
    Acirc: "Â",
    Atilde: "Ã",
    Auml: "Ä",
    Aring: "Å",
    AElig: "Æ",
    Ccedil: "Ç",
    Egrave: "È",
    Eacute: "É",
    Ecirc: "Ê",
    Euml: "Ë",
    Igrave: "Ì",
    Iacute: "Í",
    Icirc: "Î",
    Iuml: "Ï",
    Ntilde: "Ñ",
    Ograve: "Ò",
    Oacute: "Ó",
    Ocirc: "Ô",
    Otilde: "Õ",
    Ouml: "Ö",
    Oslash: "Ø",
    Ugrave: "Ù",
    Uacute: "Ú",
    Ucirc: "Û",
    Uuml: "Ü",
    Yacute: "Ý",
    agrave: "à",
    aacute: "á",
    acirc: "â",
    atilde: "ã",
    auml: "ä",
    aring: "å",
    aelig: "æ",
    ccedil: "ç",
    egrave: "è",
    eacute: "é",
    ecirc: "ê",
    euml: "ë",
    igrave: "ì",
    iacute: "í",
    icirc: "î",
    iuml: "ï",
    ntilde: "ñ",
    ograve: "ò",
    oacute: "ó",
    ocirc: "ô",
    otilde: "õ",
    ouml: "ö",
    oslash: "ø",
    ugrave: "ù",
    uacute: "ú",
    ucirc: "û",
    uuml: "ü",
    yacute: "ý",
    yuml: "ÿ",
};

function decodeEntities(text: string): string {
    // Une seule passe : `&amp;eacute;` devient `&eacute;` tel quel, sans
    // être re-décodé (pas de double-unescaping). Les noms d'entités
    // peuvent contenir des chiffres ("&frac12;", "&sup2;").
    return text.replace(
        /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
        (match, body: string) => {
            if (body.startsWith("#")) {
                const hex = body[1] === "x";
                const code = parseInt(
                    hex ? body.slice(2) : body.slice(1),
                    hex ? 16 : 10
                );
                if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
                    return match;
                }
                try {
                    return String.fromCodePoint(code);
                } catch {
                    return match;
                }
            }
            return NAMED_ENTITIES[body] ?? match;
        }
    );
}

function parseAmount(html: string, className: string): number {
    const text =
        html.match(
            new RegExp(`<span class="${className}">([^<]*)</span>`)
        )?.[1] ?? "";
    const value = parseFloat(text.replace(/[^0-9.\-]/g, ""));
    return Number.isNaN(value) ? 0 : value;
}

export class PrintClient {
    constructor(private session: PrintSessionManager) {}

    private async getPage(path: string): Promise<string> {
        const response = await this.session.client.get(`${PRINT_BASE}${path}`);
        if (response.statusCode !== 200) {
            throw new Error(`Page ${path} inaccessible (${response.statusCode})`);
        }
        return response.body;
    }

    async listJobs(folder: PrintFolder): Promise<PrintJob[]> {
        const html = await this.getPage(
            `/dashboard/job-list?folder=${folder}`
        );
        const jobs: PrintJob[] = [];
        const blocks = html.split('<div class="job">').slice(1);

        for (const block of blocks) {
            const id = block.match(/data-job-id="(\d+)"/)?.[1];
            if (!id) continue;
            const title =
                block.match(
                    /<div class="job-title">([\s\S]*?)<\/div>/
                )?.[1] ?? "";
            const overview =
                block.match(
                    /<div class="job-basic-overview">([\s\S]*?)<\/div>/
                )?.[1] ?? "";
            const [date = "", owner = ""] = decodeEntities(overview)
                .trim()
                .split(" | ");
            jobs.push({
                id,
                name: decodeEntities(title)
                    .trim()
                    .replace(/^Mobile print:\s*/, ""),
                date: date.trim(),
                owner: owner.trim(),
            });
        }
        return jobs;
    }

    async deleteJobs(ids: string[]): Promise<void> {
        const html = await this.getPage("/dashboard");
        const csrf = html.match(
            /id="last-jobs-delete"[^>]*data-csrf-token="([^"]+)"/
        )?.[1];
        if (!csrf) {
            throw new Error("Token CSRF de suppression introuvable");
        }

        const body = ids
            .map((id) => `ids[]=${encodeURIComponent(id)}`)
            .join("&");
        const response = await this.session.client.post(
            `${PRINT_BASE}/dashboard/delete-job`,
            {
                body,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "X-CSRF-TOKEN": csrf,
                },
            }
        );
        if (response.statusCode !== 302 && response.statusCode !== 200) {
            throw new Error(`Suppression échouée (${response.statusCode})`);
        }
    }

    async uploadJob(
        buffer: Buffer,
        filename: string,
        mimeType: string,
        bw: boolean,
        duplex: boolean
    ): Promise<void> {
        const html = await this.getPage("/upload-job");
        const csrf = html.match(/name="csrfToken"[^>]*value="([^"]+)"/)?.[1];
        if (!csrf) {
            throw new Error("Token CSRF d'envoi introuvable");
        }

        const form = new FormData();
        form.append("bw", String(bw));
        form.append("duplex", String(duplex));
        form.append(
            "importFile",
            new Blob([new Uint8Array(buffer)], { type: mimeType }),
            filename
        );

        const response = await this.session.client.post(
            `${PRINT_BASE}/upload-job`,
            {
                body: form,
                headers: { "X-CSRF-TOKEN": csrf },
            }
        );
        if (response.statusCode !== 200) {
            throw new Error(`Envoi échoué (${response.statusCode})`);
        }
    }

    async getBalance(): Promise<PrintBalance> {
        const html = await this.getPage("/dashboard/balance-info");
        return {
            personal: parseAmount(html, "personal-balance"),
            bonus: parseAmount(html, "virtual-balance"),
        };
    }
}
