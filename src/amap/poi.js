import { amapGet } from './utils.js';

export async function resolvePlace(keywords, key) {
  const data = await amapGet('/v5/place/text', { keywords, key, page_size: 10 });
  const pois = data.pois || data.data?.pois || [];
  if (!pois.length) {
    const error = new Error('PLACE_NOT_FOUND'); error.status = 400; throw error;
  }
  const poi = pois[0];
  const location = String(poi.location || '').split(',').map(Number);
  if (!Number.isFinite(location[0]) || !Number.isFinite(location[1])) throw new Error('PLACE_LOCATION_UNAVAILABLE');
  return {
    id: poi.id || poi.poi_id || '', name: poi.name || keywords,
    address: poi.address || poi.pname || '地址未提供',
    location: { lng: location[0], lat: location[1] }, city: poi.cityname || poi.city || '',
    citycode: poi.citycode || '', adcode: poi.adcode || ''
  };
}
