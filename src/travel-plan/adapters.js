import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { flights, hotelDetail, hotelImages, hotels, trains } from '../ctrip/service.js';
import { resolvePlace } from '../amap/poi.js';
import { getDrivingRoute } from '../amap/driving.js';
import { getTransitRoute } from '../amap/transit.js';
import { regenerateFromSavedDetails, researchAndGenerate, researchPitfallTips, researchStayAreas, researchTargetImages } from '../xiaohongshu/research.js';
import { fileSlug } from '../xiaohongshu/guide.js';

async function hasSavedDetails(destination) {
  try {
    await access(path.resolve('data/processed/debug', fileSlug(destination), '03_fetched_posts.json'));
    await access(path.resolve('data/processed/debug', fileSlug(destination), '08_validation_report.json'));
    return true;
  } catch { return false; }
}

export function createAdapters() {
  const amapKey = process.env.AMAP_WEB_SERVICE_KEY;
  const poiCache = new Map();
  const routeCache = new Map();
  return {
    social: {
      async research(destination, request) {
        const result = await (await hasSavedDetails(destination)
          ? regenerateFromSavedDetails(destination, { writeHtml: false })
          : researchAndGenerate(destination, { writeHtml: false, days: request.trip.days, month: Number(request.trip.start_date.slice(5, 7)) }));
        return JSON.parse(await readFile(result.guideFile, 'utf8'));
      },
      async enrichImages(destination, targets) { return researchTargetImages(destination, targets); },
      async researchPitfalls(destination) { return researchPitfallTips(destination); },
      async researchStayAreas(destination) { return researchStayAreas(destination); }
    },
    inventory: { searchFlights: flights, searchTrains: trains, searchHotels: hotels, getHotelDetail: hotelDetail, getHotelImages: hotelImages },
    geo: {
      async searchPoi(query) {
        if (!amapKey) throw new Error('AMAP_WEB_SERVICE_KEY 未配置。');
        if (!poiCache.has(query)) poiCache.set(query, resolvePlace(query, amapKey).then((poi) => ({ ...poi, provider: 'amap' })).catch((error) => { poiCache.delete(query); throw error; }));
        return poiCache.get(query);
      },
      async route(origin, destination, mode = 'driving') {
        if (!amapKey) throw new Error('AMAP_WEB_SERVICE_KEY 未配置。');
        const cacheKey = `${mode}:${origin.id || `${origin.location.lng},${origin.location.lat}`}->${destination.id || `${destination.location.lng},${destination.location.lat}`}`;
        if (!routeCache.has(cacheKey)) routeCache.set(cacheKey, (mode === 'transit' ? getTransitRoute(origin, destination, amapKey) : getDrivingRoute(origin, destination, amapKey)).catch((error) => { routeCache.delete(cacheKey); throw error; }));
        return routeCache.get(cacheKey);
      }
    }
  };
}
