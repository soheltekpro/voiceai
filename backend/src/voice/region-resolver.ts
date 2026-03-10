/**
 * Multi-region voice routing: resolve caller IP to nearest region and optionally fail over.
 */

import { config } from '../config.js';

export type VoiceRegion = { id: string; url: string };

const REGIONS = config.voiceRegions as readonly VoiceRegion[];

/** Continent/country to preferred region id (nearest). */
const COUNTRY_TO_REGION: Record<string, string> = {
  IN: 'ap-south',
  PK: 'ap-south',
  BD: 'ap-south',
  LK: 'ap-south',
  NP: 'ap-south',
  SG: 'ap-south',
  MY: 'ap-south',
  TH: 'ap-south',
  ID: 'ap-south',
  PH: 'ap-south',
  AU: 'ap-south',
  NZ: 'ap-south',
  JP: 'ap-south',
  KR: 'ap-south',
  GB: 'eu-west',
  DE: 'eu-west',
  FR: 'eu-west',
  IT: 'eu-west',
  ES: 'eu-west',
  NL: 'eu-west',
  PL: 'eu-west',
  SE: 'eu-west',
  IE: 'eu-west',
  BE: 'eu-west',
  AT: 'eu-west',
  CH: 'eu-west',
  PT: 'eu-west',
  US: 'us-east',
  CA: 'us-east',
  MX: 'us-east',
  BR: 'us-east',
};

const CONTINENT_TO_REGION: Record<string, string> = {
  AS: 'ap-south',
  OC: 'ap-south',
  EU: 'eu-west',
  AF: 'eu-west',
  NA: 'us-east',
  SA: 'us-east',
};

const DEFAULT_REGION_ID = REGIONS[0]?.id ?? 'us-east';

/** Result of IP geolocation (e.g. from ipapi.co). */
type GeoResponse = {
  country_code?: string;
  continent_code?: string;
  error?: boolean;
};

const GEO_CACHE = new Map<string, { regionId: string; at: number }>();
const GEO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function parseIp(ip: string): string {
  const trimmed = (ip ?? '').trim();
  if (!trimmed) return '';
  const forwarded = trimmed.split(',')[0]?.trim();
  return forwarded ?? trimmed;
}

/**
 * Call ipapi.co to get country/continent for IP. No API key needed (free tier).
 */
async function lookupGeo(ip: string): Promise<GeoResponse | null> {
  const clean = parseIp(ip);
  if (!clean || clean === '127.0.0.1' || clean === '::1' || clean.startsWith('192.168.') || clean.startsWith('10.')) {
    return null;
  }
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(clean)}/json/`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as GeoResponse;
    if (data?.error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Map country/continent to nearest region id.
 */
function geoToRegionId(geo: GeoResponse | null): string {
  if (!geo) return DEFAULT_REGION_ID;
  const country = (geo.country_code ?? '').toUpperCase();
  const continent = (geo.continent_code ?? '').toUpperCase();
  const byCountry = country && COUNTRY_TO_REGION[country];
  if (byCountry && REGIONS.some((r) => r.id === byCountry)) return byCountry;
  const byContinent = continent && CONTINENT_TO_REGION[continent];
  if (byContinent && REGIONS.some((r) => r.id === byContinent)) return byContinent;
  return DEFAULT_REGION_ID;
}

/**
 * Resolve caller IP to the nearest voice region id.
 * Uses IP geolocation (ipapi.co); caches result for 1 hour per IP.
 */
export async function resolveVoiceRegion(ipAddress: string): Promise<string> {
  const ip = parseIp(ipAddress);
  if (!ip) return DEFAULT_REGION_ID;

  const cached = GEO_CACHE.get(ip);
  if (cached && Date.now() - cached.at < GEO_CACHE_TTL_MS) return cached.regionId;

  const geo = await lookupGeo(ip);
  const regionId = geoToRegionId(geo);
  GEO_CACHE.set(ip, { regionId, at: Date.now() });
  return regionId;
}

/**
 * Return ordered list of region ids for failover: nearest first, then others.
 */
export function getRegionFallbackOrder(primaryRegionId: string): string[] {
  const ids = REGIONS.map((r) => r.id);
  const primary = primaryRegionId && ids.includes(primaryRegionId) ? primaryRegionId : ids[0];
  const rest = ids.filter((id) => id !== primary);
  return [primary, ...rest];
}

/**
 * Get WebSocket base URL for a region (e.g. wss://voice-us.example.com).
 * Strips trailing slash.
 */
export function getRegionalWsBaseUrl(regionId: string): string | null {
  const r = REGIONS.find((x) => x.id === regionId);
  if (!r) return null;
  const url = r.url.trim().replace(/\/+$/, '');
  return url ? url.replace(/^http/, 'wss') : null;
}

const REGION_HEALTH_CHECK_ENABLED = process.env['VOICE_REGION_HEALTH_CHECK'] === 'true';
const REGION_HEALTH_TIMEOUT_MS = 2000;

/**
 * Check if a region base URL is reachable (HEAD request). Used for failover when primary is down.
 */
async function isRegionAvailable(wsBaseUrl: string): Promise<boolean> {
  if (!REGION_HEALTH_CHECK_ENABLED) return true;
  const httpUrl = wsBaseUrl.replace(/^wss/, 'https').replace(/^ws/, 'http');
  try {
    const res = await fetch(httpUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(REGION_HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve region and optional regional WebSocket URL with failover.
 * If primary region URL is missing or unavailable (when VOICE_REGION_HEALTH_CHECK=true), tries next nearest region.
 */
export async function resolveVoiceRegionWithFailover(ipAddress: string): Promise<{
  regionId: string;
  wsBaseUrl: string | null;
  fallbackRegionIds: string[];
}> {
  const regionId = await resolveVoiceRegion(ipAddress);
  const fallbackRegionIds = getRegionFallbackOrder(regionId);
  let chosenRegionId = fallbackRegionIds[0] ?? regionId;
  let wsBaseUrl: string | null = null;
  for (const rid of fallbackRegionIds) {
    const url = getRegionalWsBaseUrl(rid);
    if (!url) continue;
    const available = await isRegionAvailable(url);
    if (available) {
      wsBaseUrl = url;
      chosenRegionId = rid;
      break;
    }
  }
  if (!wsBaseUrl && getRegionalWsBaseUrl(chosenRegionId)) {
    wsBaseUrl = getRegionalWsBaseUrl(chosenRegionId);
  }
  return {
    regionId: chosenRegionId,
    wsBaseUrl,
    fallbackRegionIds,
  };
}
