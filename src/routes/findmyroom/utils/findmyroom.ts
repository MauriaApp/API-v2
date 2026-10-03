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

// Once the day is over findmyroom keeps reporting every room "DISPONIBLE",
// "libre jusqu'à 20:00" long after 20:00 has gone by. The closing time isn't
// fixed (20:00 is only the usual one), so it's read from that sentence and
// compared with the upstream's own clock ("heure", Paris time — the API
// host's clock may be on another timezone).
const FREE_UNTIL_RE = /(?:jusqu['’]à|until)\s+(\d{1,2}):(\d{2})/i;
const CLOCK_RE = /^(\d{1,2}):(\d{2})/;

function clockMinutes(match: RegExpExecArray): number {
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function markClosedRooms(data: RoomsForBuilding): RoomsForBuilding {
    const now = CLOCK_RE.exec(data.heure);
    if (!now) return data;
    const nowMinutes = clockMinutes(now);

    return {
        ...data,
        salles: data.salles.map((room) => {
            if (room.statut !== "DISPONIBLE" || !room.libre_jusqua) return room;
            const until = FREE_UNTIL_RE.exec(room.libre_jusqua);
            if (!until || nowMinutes < clockMinutes(until)) return room;
            return { ...room, statut: "FERMEE" };
        }),
    };
}

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
        const { batiments } = await fetchJson<{
            batiments: Omit<Building, "fermees">[];
        }>(
            "/api/batiments-stats"
        );
        const data = await Promise.all(batiments.map(withoutClosedRooms));
        buildingsCache = { data, fetchedAt: Date.now() };
        return data;
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
        const data = markClosedRooms(
            await fetchJson<RoomsForBuilding>(
                `/api/salles/${encodeURIComponent(buildingCode)}`
            )
        );
        roomsCache.set(buildingCode, { data, fetchedAt: Date.now() });
        return data;
    } catch (error) {
        if (cached) return cached.data;
        throw error;
    }
}

/**
 * The building stats count closed rooms as free too, and don't say which
 * rooms they counted: the building's rooms (cached, shared with the rooms
 * route) tell how many to take off. Upstream figures are kept as they are
 * when the rooms can't be fetched.
 */
async function withoutClosedRooms(
    building: Omit<Building, "fermees">
): Promise<Building> {
    try {
        const { salles } = await getRoomsForBuilding(building.code);
        const closed = salles.filter((room) => room.statut === "FERMEE").length;
        if (closed === 0) return { ...building, fermees: 0 };
        const dispo = Math.max(0, building.dispo - closed);
        return {
            ...building,
            dispo,
            fermees: closed,
            pourcentage:
                building.total > 0
                    ? Math.round((dispo / building.total) * 100)
                    : 0,
        };
    } catch {
        return { ...building, fermees: 0 };
    }
}
