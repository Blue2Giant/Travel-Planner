import { dateAdd } from './requirements.js';
import { validateTravelPlan } from './validator.js';

const timestamp = () => new Date().toISOString();
const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const durationMinutes = (value) => {
  if (Number.isFinite(Number(value))) return Number(value);
  const text = String(value || '');
  return Number(text.match(/(\d+(?:\.\d+)?)\s*(?:小时|时|h)/i)?.[1] || 0) * 60 + Number(text.match(/(\d+)\s*(?:分钟|分|min)/i)?.[1] || 0) || null;
};
const location = (poi) => ({ lng: poi.location.lng, lat: poi.location.lat });
const unavailable = (mode, reason) => ({ mode, unavailable: true, reason });

async function attempt(label, warnings, operation) {
  try { return await operation(); } catch (error) { warnings.push(`${label}：${error.message}`); return null; }
}

function imageEvidence(item, guide) {
  const sourceMap = new Map(guide.sources.map((source) => [source.feedId, source]));
  return (item.images || []).filter((image) => image.confidence == null || image.confidence >= 0.8).map((image) => {
    const source = sourceMap.get(image.sourceFeedId);
    return { ...image, url: String(image.url || '').replace(/^http:\/\//i, 'https://'), source_note_id: image.sourceFeedId, source_post_url: source?.url || null, source_image_index: image.sourceImageIndex };
  });
}

function socialEvidence(guides) {
  const attractions = guides.flatMap((guide) => guide.highlights.map((item) => ({
    id: `${guide.destination}-${item.name}`, city: guide.destination, name: item.name, summary: item.description,
    highlights: [item.description], support_count: new Set(item.sources).size, source_posts: item.sources,
    images: imageEvidence(item, guide), recommended_duration_minutes: /雪山|国家公园|峡谷|大索道/.test(item.name) ? 240 : 120,
    truth: { experience: 'aggregated', duration: 'estimated' }
  }))).filter((item) => item.support_count >= 2);
  const foods = guides.flatMap((guide) => guide.food.map((item) => ({ ...item, city: guide.destination, images: imageEvidence(item, guide).slice(0, 1) }))).slice(0, 10);
  const tips = guides.flatMap((guide) => guide.tips.map((item) => ({ ...item, city: guide.destination }))).slice(0, 14);
  const stayAreas = guides.flatMap((guide) => guide.stayAreas.map((item) => ({ ...item, city: guide.destination })));
  const sources = [...new Map(guides.flatMap((guide) => guide.sources).map((source) => [source.feedId, source])).values()];
  return { attractions, foods, tips, stayAreas, sources };
}

async function verifyAttractions(evidence, adapters, warnings) {
  const verified = [];
  for (const item of evidence.attractions) {
    const poi = await attempt(`高德未能识别“${item.city} ${item.name}”`, warnings, () => adapters.geo.searchPoi(`${item.city} ${item.name}`));
    if (poi) verified.push({ ...item, poi, coordinates: location(poi), truth: { ...item.truth, poi: 'verified' } });
  }
  return verified;
}

function score(item, avoidEarly) {
  const hour = Number(String(item.departure_time || '').slice(0, 2));
  return (durationMinutes(item.duration) || 420) + (numeric(item.price ?? item.from_price) || 1800) / 8 + (avoidEarly && hour < 7 ? 800 : 0);
}
function rank(items, preferences) { return [...items].sort((a, b) => score(a, preferences.avoid_early_morning) - score(b, preferences.avoid_early_morning)); }
function flight(item) { return { ...item, mode: 'flight', duration_minutes: durationMinutes(item.duration), price: item.price ?? null, provider: 'ctrip', truth: 'verified' }; }
function train(item) { return { ...item, mode: 'train', duration_minutes: durationMinutes(item.duration), price: item.from_price ?? item.price ?? null, from: item.departure_station, to: item.arrival_station, provider: 'ctrip', truth: 'verified' }; }

async function planTransport(request, adapters, warnings) {
  const first = request.trip.destinations[0]; const last = request.trip.destinations.at(-1);
  const queryPair = async (from, to, date, label) => {
    const flightResult = await attempt(`${label}航班查询失败`, warnings, () => adapters.inventory.searchFlights({ origin: from, destination: to, date, limit: 12 }));
    const trainResult = await attempt(`${label}列车查询失败`, warnings, () => adapters.inventory.searchTrains({ origin: from, destination: to, date, limit: 12 }));
    const rankedFlights = rank((flightResult?.results || []).filter((item) => !/^\+\d+天$/.test(item.arrival_airport || '') && item.departure_airport && item.arrival_airport).map(flight), request.preferences);
    const rankedTrains = rank((trainResult?.results || []).map(train), request.preferences);
    const failed = !flightResult && !trainResult;
    return { recommended: rankedFlights[0] || rankedTrains[0] || unavailable('flight', failed ? '上游查询失败，不能据此判断无票；请稍后重试。' : '查询成功，但未返回可推荐班次。'), alternatives: [...rankedFlights.slice(1, 3), ...rankedTrains.slice(0, 2)].slice(0, 3) };
  };
  const outbound = await queryPair(request.trip.origin, first, request.trip.start_date, '去程');
  const returning = await queryPair(last, request.trip.origin, request.trip.end_date, '返程');
  const intercity = [];
  for (let index = 0; index < request.trip.destinations.length - 1; index += 1) {
    const from = request.trip.destinations[index]; const to = request.trip.destinations[index + 1];
    const date = dateAdd(request.trip.start_date, Math.max(1, Math.round(request.trip.days * (index + 1) / request.trip.destinations.length) - 1));
    const result = await attempt(`${from}到${to}列车查询失败`, warnings, () => adapters.inventory.searchTrains({ origin: from, destination: to, date, limit: 12 }));
    const options = rank((result?.results || []).map(train), request.preferences);
    intercity.push({ from, to, date, recommended: options[0] || unavailable('train', '未查询到城际列车。'), alternatives: options.slice(1, 4) });
  }
  return { outbound, return: returning, intercity };
}

function dayAllocation(request) {
  const result = new Map(request.trip.destinations.map((city) => [city, 1]));
  for (let index = request.trip.destinations.length; index < request.trip.days; index += 1) { const city = request.trip.destinations[index % request.trip.destinations.length]; result.set(city, result.get(city) + 1); }
  return result;
}

function stayWindows(request) {
  const allocation = dayAllocation(request); let cursor = 0;
  return request.trip.destinations.map((city) => { const days = allocation.get(city); const checkin = dateAdd(request.trip.start_date, cursor); cursor += days; return { city, days, checkin, checkout: dateAdd(request.trip.start_date, Math.min(cursor, request.trip.nights)) }; });
}

async function planHotels(request, evidence, adapters, warnings) {
  const stays = [];
  for (const window of stayWindows(request)) {
    const areaEvidence = evidence.stayAreas.find((item) => item.city === window.city); const area = areaEvidence?.name || `${window.city}市中心`;
    const result = await attempt(`携程${window.city}酒店查询失败`, warnings, () => adapters.inventory.searchHotels({ city: window.city, checkin: window.checkin, checkout: window.checkout, keyword: area, min_score: 4, limit: 10 }));
    const options = [...(result?.results || [])].sort((a, b) => (numeric(b.score) || 0) - (numeric(a.score) || 0) || (numeric(a.price) || Infinity) - (numeric(b.price) || Infinity)).map((item) => ({
      ...item, city: window.city, area: item.district || area, xhs_area: area, price_per_night: item.price, rating: item.score,
      advantages: [`匹配小红书推荐区域“${area}”`, '携程真实候选，价格和库存以下单页为准。'], provider: 'ctrip', truth: 'verified'
    }));
    stays.push({ ...window, area, area_evidence: areaEvidence || null, recommended: options.slice(0, 2), alternatives: options.slice(2, 5) });
  }
  return { recommended_area: stays.map((item) => `${item.city}：${item.area}`).join('；'), reason: '住宿区域来自小红书多帖经验，具体酒店来自携程查询。', area_tips: stays.flatMap((item) => [...(item.area_evidence?.pros || []), ...(item.area_evidence?.cons || [])]).slice(0, 6), stays, recommended: stays.flatMap((item) => item.recommended), alternatives: stays.flatMap((item) => item.alternatives) };
}

async function stayAnchor(stay, adapters, warnings) {
  const hotel = stay.recommended[0];
  if (hotel && numeric(hotel.lon) !== null && numeric(hotel.lat) !== null) return { id: hotel.hotel_id, name: hotel.name, address: hotel.address, location: { lng: Number(hotel.lon), lat: Number(hotel.lat) }, provider: 'ctrip' };
  return attempt(`高德住宿区域“${stay.city} ${stay.area}”查询失败`, warnings, () => adapters.geo.searchPoi(`${stay.city} ${stay.area}`));
}

function distribute(items, days, cap) { const buckets = Array.from({ length: days }, () => []); items.slice(0, days * cap).forEach((item, index) => buckets[index % days].push(item)); return buckets; }
function clock(totalMinutes) { return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(Math.round(totalMinutes % 60)).padStart(2, '0')}`; }
function haversine(a, b) { const rad = (value) => value * Math.PI / 180; const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }

async function routeLeg(from, to, adapters, warnings) {
  const value = await attempt(`高德路线 ${from.name} → ${to.name} 查询失败`, warnings, () => adapters.geo.route(from, to, 'driving'));
  if (!value) return { from: from.name, to: to.name, mode: 'driving', mode_label: '驾车 / 打车', unavailable: true, provider: 'amap', polyline: [] };
  return { from: from.name, to: to.name, mode: 'driving', mode_label: '驾车 / 打车', distance_meters: value.distanceMeters, duration_minutes: value.durationMinutes, polyline: value.polyline, steps: value.steps || [], provider: 'amap', queried_at: timestamp(), truth: 'verified' };
}

async function scheduleDays(request, attractions, hotel, transport, adapters, warnings) {
  const allocation = dayAllocation(request); const days = []; let number = 1;
  const cap = request.preferences.pace === 'relaxed' ? Math.min(3, request.constraints.max_daily_attractions) : request.constraints.max_daily_attractions;
  for (const [cityIndex, city] of request.trip.destinations.entries()) {
    const stay = hotel.stays.find((item) => item.city === city); const anchor = await stayAnchor(stay, adapters, warnings);
    if (!anchor) throw new Error(`无法为${city}确定住宿地图锚点。`);
    const anchorLocation = location(anchor);
    const candidates = attractions.filter((item) => item.city === city).map((item) => ({ ...item, estimated_roundtrip_minutes: Math.round(haversine(anchorLocation, item.coordinates) * 2 / 45 * 60) })).sort((a, b) => a.estimated_roundtrip_minutes - b.estimated_roundtrip_minutes);
    const eligible = candidates.filter((item) => item.estimated_roundtrip_minutes <= request.constraints.max_daily_commute_minutes * 1.15);
    for (const item of candidates.filter((candidate) => !eligible.includes(candidate))) warnings.push(`${item.name}距住宿区域较远，未塞入日程，保留在景点候选中。`);
    const buckets = distribute(eligible, allocation.get(city), cap);
    for (const bucket of buckets) {
      const firstDay = number === 1; const lastDay = number === request.trip.days;
      const sequence = [anchor, ...bucket.map((item) => item.poi), ...(bucket.length ? [anchor] : [])]; const legs = [];
      const pointImages = new Map(bucket.map((item) => [item.poi.id, item.images?.[0] || null]));
      for (let index = 0; index < sequence.length - 1; index += 1) legs.push(await routeLeg(sequence[index], sequence[index + 1], adapters, warnings));
      let cursor = firstDay ? 15 * 60 : 9 * 60;
      const transfer = cityIndex > 0 && number === [...allocation.values()].slice(0, cityIndex).reduce((sum, value) => sum + value, 0) + 1 ? transport.intercity[cityIndex - 1]?.recommended : null;
      const timeline = [{ time: transfer?.departure_time || clock(cursor), type: transfer ? 'transport' : 'hotel', title: transfer ? `${transfer.train_no || '城际列车'}：${transfer.from} → ${transfer.to}` : firstDay ? `抵达并前往 ${anchor.name}` : `从 ${anchor.name} 出发`, place: anchor.name, coordinates: location(anchor), subtitle: transfer ? `${transfer.departure_time || '—'} 出发，${transfer.arrival_time || '—'} 抵达；随后前往住宿` : firstDay ? '抵达、接驳、入住和休息' : '住宿 / 集合点' }];
      bucket.forEach((item, index) => { cursor += legs[index]?.duration_minutes || 30; timeline.push({ time: clock(cursor), type: 'attraction', title: item.name, place: item.name, coordinates: item.coordinates, duration_minutes: item.recommended_duration_minutes, highlights: item.highlights.slice(0, 1), attraction_id: item.id }); cursor += item.recommended_duration_minutes; });
      cursor += bucket.length ? (legs.at(-1)?.duration_minutes || 30) : 0;
      timeline.push({ time: clock(cursor), type: lastDay ? 'transport' : 'hotel', title: lastDay ? '前往交通枢纽，准备晚间返程' : `返回 ${anchor.name}`, place: anchor.name, coordinates: location(anchor), subtitle: lastDay ? '以携程返程班次为准' : '休息 / 晚餐' });
      days.push({ day: number, date: dateAdd(request.trip.start_date, number - 1), city, theme: bucket.map((item) => item.name).join(' · ') || `${city}机动日`, stay_area: stay.area, timeline, route_legs: legs, attraction_count: bucket.length, map: { points: sequence.map((item, index) => { const image = pointImages.get(item.id); return { id: `${number}-${index}`, name: item.name, order: index + 1, ...location(item), image_url: image?.url || null, image_caption: image?.caption || null }; }), legs } });
      number += 1;
    }
  }
  return days;
}

export async function createTravelPlan(request, adapters) {
  const warnings = []; const guides = [];
  for (const city of request.trip.destinations) guides.push(await adapters.social.research(city, request));
  const evidence = socialEvidence(guides); const attractions = await verifyAttractions(evidence, adapters, warnings);
  if (!attractions.length) throw new Error('没有找到同时满足“小红书多帖共识”和“高德 POI 可验证”的景点。');
  const transport = await planTransport(request, adapters, warnings);
  const hotel = await planHotels(request, evidence, adapters, warnings);
  const days = await scheduleDays(request, attractions, hotel, transport, adapters, warnings);
  const plan = { trip: { ...request.trip, assumptions: request.assumptions }, travelers: request.travelers, preferences: request.preferences, constraints: request.constraints, transport, hotel, overview: { summary: `按用户输入顺序游玩${request.trip.destinations.join('、')}，每天围绕住宿区域做空间聚类并用高德逐段验证。`, day_clusters: days.map((day) => ({ day: day.day, city: day.city, points: day.map.points.map((item) => item.name) })) }, days, attractions, foods: evidence.foods, practical_tips: evidence.tips, source_posts: evidence.sources, metadata: { generated_at: timestamp(), mode: 'live', mode_label: 'LIVE · 三源编排', xhs_post_count: evidence.sources.length, xhs_query_time: timestamp(), ctrip_query_time: timestamp(), amap_query_time: timestamp(), warnings } };
  plan.validation = validateTravelPlan(plan);
  if (!plan.validation.valid) throw new Error(`旅行规划校验失败：${plan.validation.errors.join('；')}`);
  plan.metadata.warnings = plan.validation.warnings;
  return plan;
}
