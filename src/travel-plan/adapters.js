import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { flights, hotels, trains } from '../ctrip/service.js';
import { resolvePlace } from '../amap/poi.js';
import { getDrivingRoute } from '../amap/driving.js';
import { getTransitRoute } from '../amap/transit.js';
import { regenerateFromSavedDetails, researchAndGenerate } from '../xiaohongshu/research.js';
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
  return {
    social: {
      async research(destination, request) {
        const result = await (await hasSavedDetails(destination)
          ? regenerateFromSavedDetails(destination, { writeHtml: false })
          : researchAndGenerate(destination, { writeHtml: false, days: request.trip.days, month: Number(request.trip.start_date.slice(5, 7)) }));
        return JSON.parse(await readFile(result.guideFile, 'utf8'));
      }
    },
    inventory: { searchFlights: flights, searchTrains: trains, searchHotels: hotels },
    geo: {
      async searchPoi(query) { if (!amapKey) throw new Error('AMAP_WEB_SERVICE_KEY 未配置。'); return { ...(await resolvePlace(query, amapKey)), provider: 'amap' }; },
      async route(origin, destination, mode = 'driving') { if (!amapKey) throw new Error('AMAP_WEB_SERVICE_KEY 未配置。'); return mode === 'transit' ? getTransitRoute(origin, destination, amapKey) : getDrivingRoute(origin, destination, amapKey); }
    }
  };
}
