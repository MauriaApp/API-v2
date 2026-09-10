// Déduction de l'instance Aurion à partir de l'email de connexion.
//
// Les domaines sont de la forme :
//   @<école>.<tld> | @student.<école>.<tld>
// et l'instance Aurion correspondante est https://aurion.<école>.<tld>
// (Junia : aurion.junia.com — IESEG : aurion.ieseg.fr — on conserve le TLD).
//
// L'API reste permissive : tout domaine bien formé produit une URL. La notion
// d'« école officiellement supportée » (et la confirmation associée) vit côté
// Webapp.

export const DEFAULT_AURION_BASE_URL = "https://aurion.junia.com";

/** Exceptions : école -> URL Aurion complète, quand elle ne suit pas la règle. */
const AURION_URL_OVERRIDES: Record<string, string> = {};

/** Extrait le jeton « école » d'un domaine email (`student.junia.com` -> `junia`). */
export function getSchoolFromEmail(email: string): string | null {
    const domain = email.split("@")[1]?.toLowerCase().trim();
    if (!domain || !domain.includes(".")) return null;
    return domain.replace(/^student\./, "").split(".")[0] || null;
}

/** URL de base Aurion pour l'email fourni. Lève si l'email est mal formé. */
export function getAurionBaseUrl(email: string): string {
    const domain = email.split("@")[1]?.toLowerCase().trim();
    if (!domain || !domain.includes(".")) {
        throw new Error(`Adresse email invalide : "${email}"`);
    }
    const parts = domain.replace(/^student\./, "").split(".");
    const school = parts[0];
    const tld = parts[parts.length - 1];
    if (!school || !tld) {
        throw new Error(`École introuvable pour le domaine "${domain}"`);
    }
    return AURION_URL_OVERRIDES[school] ?? `https://aurion.${school}.${tld}`;
}
