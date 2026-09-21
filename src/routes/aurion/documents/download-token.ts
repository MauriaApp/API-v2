import crypto from "crypto";
import { DownloadType } from "./documents";

/**
 * Short-lived, self-contained download tokens.
 *
 * Mobile WebViews silently drop `<a download>` on a `blob:` URL, so the
 * Webapp can't save a document it fetched over POST.  Instead it mints a
 * token here and hands the resulting GET URL to the system browser, which
 * downloads it natively.  The API stays stateless — the token *is* the
 * request — because several Fly machines may serve the pair of calls.
 *
 * The payload carries Aurion credentials, so it is encrypted (never merely
 * signed) and expires after two minutes.
 */

const TOKEN_TTL_MS = 2 * 60 * 1000;
const KEY_SALT = "mauria-document-download";

export interface DownloadTokenPayload {
    email: string;
    password: string;
    category: string;
    docIndex: number;
    downloadType: DownloadType;
    submitParam: string;
    selectName?: string;
    optionValue?: string;
    downloadButtonParam?: string;
    consulterParam?: string;
}

interface SealedPayload extends DownloadTokenPayload {
    exp: number;
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
    if (cachedKey) return cachedKey;

    const secret = process.env.DOWNLOAD_SECRET || process.env.SUPABASE_KEY;
    if (!secret) {
        throw new Error(
            "DOWNLOAD_SECRET (or SUPABASE_KEY) must be set to issue download tokens"
        );
    }

    cachedKey = crypto.scryptSync(secret, KEY_SALT, 32);
    return cachedKey;
}

export function createDownloadToken(payload: DownloadTokenPayload): string {
    const sealed: SealedPayload = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
    const body = Buffer.concat([
        cipher.update(JSON.stringify(sealed), "utf8"),
        cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function readDownloadToken(token: string): DownloadTokenPayload {
    const raw = Buffer.from(token, "base64url");
    if (raw.length <= 28) throw new Error("Lien de téléchargement invalide");

    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const body = raw.subarray(28);

    let json: string;
    try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
        decipher.setAuthTag(tag);
        json = Buffer.concat([
            decipher.update(body),
            decipher.final(),
        ]).toString("utf8");
    } catch {
        throw new Error("Lien de téléchargement invalide");
    }

    const sealed = JSON.parse(json) as SealedPayload;
    if (!sealed.exp || sealed.exp < Date.now()) {
        throw new Error("Lien de téléchargement expiré");
    }

    const { exp: _exp, ...payload } = sealed;
    return payload;
}

export { TOKEN_TTL_MS };
