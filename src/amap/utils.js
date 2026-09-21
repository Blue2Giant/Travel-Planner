export function parsePolyline(value) {
  if (!value) return [];
  // Transit v5 returns geometry as { polyline: "lng,lat;..." }, while
  // driving returns the string directly. Unwrap either shape recursively.
  if (typeof value === 'object' && !Array.isArray(value) && value.polyline) return parsePolyline(value.polyline);
  if (Array.isArray(value)) {
    if (value.length >= 2 && value.every((part) => Number.isFinite(Number(part)))) return [[Number(value[0]), Number(value[1])]];
    return value.flatMap(parsePolyline);
  }
  return String(value).split(';').map((point) => point.split(',').map(Number))
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
}

export function formatDistance(meters = 0) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds = 0) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}`.trim();
}

export function number(value) { return Number(value) || 0; }

// v5 puts some time values under `cost`; older responses keep them at the
// current object level. Never substitute a made-up duration when both are absent.
export function durationOf(value) {
  return number(value?.duration ?? value?.cost?.duration ?? value?.cost?.time);
}

export function polylineOf(value) {
  const direct = parsePolyline(value?.polyline);
  return direct.length ? direct : (value?.steps || []).flatMap((step) => parsePolyline(step.polyline));
}

const AMAP_MIN_INTERVAL_MS = 650;
const AMAP_QPS_CODES = new Set(['10014', '10015', '10019', '10020', '10021', '10022', '10023', 'CUQPS_HAS_EXCEEDED_THE_LIMIT', 'CKQPS_HAS_EXCEEDED_THE_LIMIT', 'CQPS_HAS_EXCEEDED_THE_LIMIT', 'QPS_HAS_EXCEEDED_THE_LIMIT', 'GATEWAY_TIMEOUT']);
let amapQueue = Promise.resolve();
let amapNextStart = 0;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function reserveAmapSlot() {
  const previous = amapQueue;
  let release;
  amapQueue = new Promise((resolve) => { release = resolve; });
  await previous;
  const delay = Math.max(0, amapNextStart - Date.now());
  if (delay) await wait(delay);
  amapNextStart = Date.now() + AMAP_MIN_INTERVAL_MS;
  release();
}

export async function amapGet(path, params) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await reserveAmapSlot();
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
    catch (error) { throw new Error(error.name === 'TimeoutError' ? 'AMAP_REQUEST_TIMEOUT' : 'AMAP_NETWORK_ERROR'); }
    const body = await response.json().catch(() => ({}));
    const info = String(body.info || ''); const infocode = String(body.infocode || '');
    if (response.ok && String(body.status) !== '0' && (!infocode || infocode === '10000')) return body;
    const qpsLimited = AMAP_QPS_CODES.has(info) || AMAP_QPS_CODES.has(infocode);
    if (qpsLimited && attempt < 2) { await wait(800 * (2 ** attempt)); continue; }
    const error = new Error(info || infocode || 'AMAP_REQUEST_FAILED');
    error.code = infocode || info || 'AMAP_REQUEST_FAILED';
    error.retryable = qpsLimited;
    throw error;
  }
  throw new Error('AMAP_REQUEST_FAILED');
}
