const STATUS_URL = "https://darklouis.dev/api/badjunia/status";

const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export interface JuniaStatus {
  aurionDown: boolean;
  aurionSince: string | null;
  wifiDown: boolean;
  wifiSince: string | null;
  /** Response time (ms) of each Aurion page, as last measured by BadJunia. */
  aurionTimes: AurionTimes;
}

/**
 * BadJunia's per-page Aurion timings: login, home, then each feature page.
 * A cold fetch through this API pays login + home + one feature page, so the
 * Webapp uses these to calibrate its fetch progress indicator. `null` when
 * the page is unknown to the upstream.
 */
export interface AurionTimes {
  login: number | null;
  home: number | null;
  grades: number | null;
  planning: number | null;
  absences: number | null;
  documents: number | null;
}

interface UpstreamIncident {
  start?: string;
  ongoing?: boolean;
}

interface UpstreamService {
  id: string;
  lastCheck?: { up?: boolean; responseTime?: number } | null;
  dailySummaries?: { incidents?: UpstreamIncident[] }[];
}

const ALL_FINE: JuniaStatus = {
  aurionDown: false,
  aurionSince: null,
  wifiDown: false,
  wifiSince: null,
  aurionTimes: {
    login: null,
    home: null,
    grades: null,
    planning: null,
    absences: null,
    documents: null,
  },
};

let cache: { data: JuniaStatus; fetchedAt: number } | null = null;

/** A service only counts as down when its last check explicitly failed. */
function isDown(services: UpstreamService[], id: string): boolean {
  return services.find((s) => s.id === id)?.lastCheck?.up === false;
}

/**
 * BadJunia checks each Aurion page separately (aurionLogin, aurionHome,
 * aurionGrades, …). Aurion counts as down as soon as one of them fails its
 * last check.
 */
function isAurionDown(services: UpstreamService[]): boolean {
  return (
    services.find(
      (s) => s.id.startsWith("aurion") && s.lastCheck?.up === false
    ) !== undefined
  );
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

/**
 * Earliest ongoing incident across the down Aurion pages: when several pages
 * are down, the warning dates back to the first one that fell.
 */
function aurionDownSince(services: UpstreamService[]): string | null {
  let earliest: string | null = null;
  for (const service of services) {
    if (!service.id.startsWith("aurion")) continue;
    if (service.lastCheck?.up !== false) continue;
    const since = downSince(services, service.id);
    if (since && (!earliest || since < earliest)) {
      earliest = since;
    }
  }
  return earliest;
}

/** Last measured response time (ms) of an upstream service, null if unknown. */
function responseTime(services: UpstreamService[], id: string): number | null {
  return services.find((s) => s.id === id)?.lastCheck?.responseTime ?? null;
}

function aurionResponseTimes(services: UpstreamService[]): AurionTimes {
  return {
    login: responseTime(services, "aurionLogin"),
    home: responseTime(services, "aurionHome"),
    grades: responseTime(services, "aurionGrades"),
    planning: responseTime(services, "aurionPlanning"),
    absences: responseTime(services, "aurionAbsences"),
    documents: responseTime(services, "aurionDocuments"),
  };
}

async function fetchStatus(): Promise<JuniaStatus> {
  const res = await fetch(STATUS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`BadJunia status ${res.status}`);

  const body = (await res.json()) as { services?: UpstreamService[] };
  const services = body.services ?? [];
  const aurionDown = isAurionDown(services);
  const wifiDown = isDown(services, "juniaNetwork");
  return {
    aurionDown,
    aurionSince: aurionDown ? aurionDownSince(services) : null,
    wifiDown,
    wifiSince: wifiDown ? downSince(services, "juniaNetwork") : null,
    aurionTimes: aurionResponseTimes(services),
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
