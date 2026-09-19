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

export async function amapGet(path, params) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(12000) }); }
  catch (error) { throw new Error(error.name === 'TimeoutError' ? 'AMAP_REQUEST_TIMEOUT' : 'AMAP_NETWORK_ERROR'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || String(body.status) === '0' || body.infocode && String(body.infocode) !== '10000') {
    throw new Error(body.info || body.infocode || 'AMAP_REQUEST_FAILED');
  }
  return body;
}
