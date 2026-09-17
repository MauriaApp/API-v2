import { Building, RoomsForBuilding } from "../../../types/findmyroom";

// findmyroom.junia.com is a small internal Flask/waitress app with no CORS
// headers at all, so the Webapp can't call it directly — this proxies it and
// adds a short cache, since the upstream itself only refreshes every 30s.
const BASE_URL = "https://findmyroom.junia.com";
const CACHE_TTL_MS = 20 * 1000;

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0";

let buildingsCache: { data: Building[]; fetchedAt: number } | null = null;
const roomsCache = new Map<string, { data: RoomsForBuilding; fetchedAt: number }>();

async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
        throw new Error(`findmyroom request failed (HTTP ${res.status})`);
    }
    return res.json() as Promise<T>;
}

export async function getBuildings(): Promise<Building[]> {
    if (buildingsCache && Date.now() - buildingsCache.fetchedAt < CACHE_TTL_MS) {
        return buildingsCache.data;
    }
    try {
        const { batiments } = await fetchJson<{ batiments: Building[] }>(
            "/api/batiments-stats"
        );
        buildingsCache = { data: batiments, fetchedAt: Date.now() };
        return batiments;
    } catch (error) {
        // Serve a stale copy rather than failing if findmyroom is briefly down.
        if (buildingsCache) return buildingsCache.data;
        throw error;
    }
}

export async function getRoomsForBuilding(
    buildingCode: string
): Promise<RoomsForBuilding> {
    const cached = roomsCache.get(buildingCode);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.data;
    }
    try {
        const data = await fetchJson<RoomsForBuilding>(
            `/api/salles/${encodeURIComponent(buildingCode)}`
        );
        roomsCache.set(buildingCode, { data, fetchedAt: Date.now() });
        return data;
    } catch (error) {
        if (cached) return cached.data;
        throw error;
    }
}
