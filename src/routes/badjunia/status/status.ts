const STATUS_URL = "https://darklouis.dev/api/badjunia/status";

const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface JuniaStatus {
  aurionDown: boolean;
  aurionSince: string | null;
  wifiDown: boolean;
  wifiSince: string | null;
}

interface UpstreamIncident {
  start?: string;
  ongoing?: boolean;
}

interface UpstreamService {
  id: string;
  lastCheck?: { up?: boolean } | null;
  dailySummaries?: { incidents?: UpstreamIncident[] }[];
}

const ALL_FINE: JuniaStatus = {
  aurionDown: false,
  aurionSince: null,
  wifiDown: false,
  wifiSince: null,
};

let cache: { data: JuniaStatus; fetchedAt: number } | null = null;

/** A service only counts as down when its last check explicitly failed. */
function isDown(services: UpstreamService[], id: string): boolean {
  return services.find((s) => s.id === id)?.lastCheck?.up === false;
}

/** Start of the ongoing incident (dailySummaries are newest first). */
function downSince(services: UpstreamService[], id: string): string | null {
  const days = services.find((s) => s.id === id)?.dailySummaries ?? [];
  for (const day of days) {
    const ongoing = day.incidents?.find((i) => i.ongoing);
    if (ongoing) return ongoing.start ?? null;
  }
  return null;
}

async function fetchStatus(): Promise<JuniaStatus> {
  const res = await fetch(STATUS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`BadJunia status ${res.status}`);

  const body = (await res.json()) as { services?: UpstreamService[] };
  const services = body.services ?? [];
  const aurionDown = isDown(services, "aurion");
  const wifiDown = isDown(services, "juniaNetwork");
  return {
    aurionDown,
    aurionSince: aurionDown ? downSince(services, "aurion") : null,
    wifiDown,
    wifiSince: wifiDown ? downSince(services, "juniaNetwork") : null,
  };
}

/**
 * Aurion / Junia Wi-Fi status from BadJunia. darklouis.dev sends no CORS
 * headers, so the Webapp can't call it directly. Falls back to the last known
 * status (or "all fine") when upstream is unreachable, so a monitoring outage
 * never shows a false warning.
 */
export async function getJuniaStatus(): Promise<JuniaStatus> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const data = await fetchStatus();
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    return cache?.data ?? ALL_FINE;
  }
}
