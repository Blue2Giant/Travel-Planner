import { dateAdd } from './requirements.js';
import { describeTransportCity, resolveTransportCity } from '../ctrip/airport-codes.js';
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
    images: imageEvidence(item, guide), primary_source_id: item.sources[0] || null, source_refs: [...new Set(item.sources)], media_refs: [], recommended_duration_minutes: /雪山|国家公园|峡谷|大索道/.test(item.name) ? 240 : 120,
    truth: { experience: 'aggregated', duration: 'estimated' }
  }))).filter((item) => item.support_count >= 2);
  const foods = guides.flatMap((guide) => guide.food.map((item) => ({ ...item, id: `${guide.destination}-${item.name}`, entity_type: 'dish', city: guide.destination, primary_source_id: item.sources?.[0] || null, source_refs: [...new Set(item.sources || [])], media_refs: [], images: imageEvidence(item, guide).slice(0, 1) }))).slice(0, 10);
  const tips = guides.flatMap((guide) => guide.tips.map((item) => ({ ...item, city: guide.destination }))).slice(0, 14);
  const stayAreas = guides.flatMap((guide) => guide.stayAreas.map((item) => ({ ...item, city: guide.destination })));
  const sources = [...new Map(guides.flatMap((guide) => guide.sources).map((source) => [source.feedId, source])).values()];
  return { attractions, foods, tips, stayAreas, sources };
}

async function enrichMissingImages(evidence, adapters, warnings) {
  if (!adapters.social.enrichImages) return evidence;
  const used = new Set([...evidence.attractions, ...evidence.foods].flatMap((item) => item.images || []).map((image) => image.url));
  for (const city of new Set([...evidence.attractions, ...evidence.foods].map((item) => item.city))) {
    const targets = [
      ...evidence.attractions.filter((item) => item.city === city && !item.images.length).map((item) => ({ id: item.id, name: item.name, kind: 'attraction' })),
      ...evidence.foods.filter((item) => item.city === city && !item.images.length).map((item) => ({ id: `${item.city}-${item.name}`, name: item.name, kind: 'food' }))
    ];
    if (!targets.length) continue;
    const result = await attempt(`小红书${city}缺图素材搜索失败`, warnings, () => adapters.social.enrichImages(city, targets));
    for (const image of result?.images || []) {
      if (used.has(image.url)) continue;
      const target = image.kind === 'attraction'
        ? evidence.attractions.find((item) => item.id === image.target_id)
        : evidence.foods.find((item) => `${item.city}-${item.name}` === image.target_id);
      if (!target || target.images.length) continue;
      target.images = [{ ...image, source_note_id: image.sourceFeedId, source_image_index: image.sourceImageIndex }]; used.add(image.url);
    }
    evidence.sources = [...new Map([...evidence.sources, ...(result?.sources || [])].map((source) => [source.feedId, source])).values()];
  }
  return evidence;
}

async function verifyAttractions(evidence, adapters, warnings) {
  const verified = [];
  for (const item of evidence.attractions) {
    const poi = await attempt(`高德未能识别“${item.city} ${item.name}”`, warnings, () => adapters.geo.searchPoi(`${item.city} ${item.name}`));
    if (poi) verified.push({ ...item, poi, coordinates: location(poi), truth: { ...item.truth, poi: 'verified' } });
  }
  return verified;
}

function score(item, preferences, journey) {
  const hour = Number(String(item.departure_time || '').slice(0, 2));
  const arrivalHour = Number(String(item.arrival_time || '').slice(0, 2));
  const morningPenalty = journey === 'outbound' && preferences.outbound_period === 'morning' && (hour < 7 || hour >= 12) ? 900 : 0;
  const lateReturnPenalty = journey === 'return' && preferences.return_period === 'late_night' && arrivalHour < 21 ? 900 : 0;
  return (durationMinutes(item.duration) || 420) + (numeric(item.price ?? item.from_price) || 1800) / 8 + (preferences.avoid_early_morning && hour < 7 ? 800 : 0) + morningPenalty + lateReturnPenalty;
}
function rank(items, preferences, journey = 'intercity') { return [...items].sort((a, b) => score(a, preferences, journey) - score(b, preferences, journey)); }
function elapsedClock(start, end) { const [sh, sm] = String(start || '').split(':').map(Number); const [eh, em] = String(end || '').split(':').map(Number); if (![sh, sm, eh, em].every(Number.isFinite)) return null; return (eh * 60 + em - sh * 60 - sm + 1440) % 1440; }
function flight(item) { return { ...item, mode: 'flight', duration_minutes: durationMinutes(item.duration) || elapsedClock(item.departure_time, item.arrival_time), price: item.price ?? null, from: item.departure_airport, to: item.arrival_airport, provider: 'ctrip', truth: 'verified' }; }
function train(item) { return { ...item, mode: 'train', duration_minutes: durationMinutes(item.duration), price: item.from_price ?? item.price ?? null, from: item.departure_station, to: item.arrival_station, provider: 'ctrip', truth: 'verified' }; }
function validTrain(item, from, to) {
  const price = numeric(item.from_price ?? item.price);
  return item.departure_station && item.arrival_station && item.departure_station.includes(from) && item.arrival_station.includes(to) && (price === null || price > 0);
}

async function planTransport(request, adapters, warnings) {
  const first = request.trip.destinations[0]; const last = request.trip.destinations.at(-1);
  const queryPair = async (from, to, date, label, journey, preferences = request.preferences) => {
    const hubFrom = resolveTransportCity(from); const hubTo = resolveTransportCity(to);
    const flightResult = await attempt(`${label}航班查询失败`, warnings, () => adapters.inventory.searchFlights({ origin: hubFrom, destination: hubTo, date, limit: 12 }));
    const trainResult = await attempt(`${label}列车查询失败`, warnings, () => adapters.inventory.searchTrains({ origin: hubFrom, destination: hubTo, date, limit: 12 }));
    const rankedFlights = rank((flightResult?.results || []).filter((item) => item.departure_airport && item.arrival_airport).map(flight), preferences, journey);
    const rankedTrains = rank((trainResult?.results || []).filter((item) => validTrain(item, hubFrom, hubTo)).map(train), preferences, journey);
    const failed = !flightResult && !trainResult;
    const options = [...rankedFlights.slice(0, 4), ...rankedTrains.slice(0, 3)].map((item) => ({ ...item, travel_date: date }));
    const hubNote = describeTransportCity(to, hubTo) || describeTransportCity(from, hubFrom);
    return { date, from, to, queried_from: hubFrom, queried_to: hubTo, hub_note: hubNote, recommended: options[0] || unavailable('flight', failed ? '上游查询失败，不能据此判断无票；请稍后重试。' : '查询成功，但未返回可推荐班次。'), alternatives: options.slice(1, 5), options };
  };
  const outbound = await queryPair(request.trip.origin, first, request.trip.start_date, '去程', 'outbound');
  const returning = await queryPair(last, request.trip.origin, request.trip.end_date, '返程', 'return');
  // 用户可能同时接受“返程当天深夜”与“次日清晨”两种收尾方式。单一 end_date
  // 只能查询其中一天，会丢掉另一种可行方案；这里额外查询次日返程并按清晨偏好排序，
  // 让报告能同时给出两个选择，而不是替用户做取舍。
  const nextDayReturn = await queryPair(last, request.trip.origin, dateAdd(request.trip.end_date, 1), '次日返程', 'return', { ...request.preferences, return_period: 'morning' });
  const intercity = [];
  for (let index = 0; index < request.trip.destinations.length - 1; index += 1) {
    const from = request.trip.destinations[index]; const to = request.trip.destinations[index + 1];
    const daysBeforeTransfer = request.trip.destinations.slice(0, index + 1).reduce((sum, city) => sum + dayAllocation(request).get(city), 0);
    const date = dateAdd(request.trip.start_date, daysBeforeTransfer);
    const hubFrom = resolveTransportCity(from); const hubTo = resolveTransportCity(to);
    const trainResult = await attempt(`${from}到${to}列车查询失败`, warnings, () => adapters.inventory.searchTrains({ origin: hubFrom, destination: hubTo, date, limit: 12 }));
    const flightResult = await attempt(`${from}到${to}航班查询失败`, warnings, () => adapters.inventory.searchFlights({ origin: hubFrom, destination: hubTo, date, limit: 8 }));
    const trainOptions = rank((trainResult?.results || []).filter((item) => validTrain(item, hubFrom, hubTo)).map(train), request.preferences);
    const flightOptions = rank((flightResult?.results || []).filter((item) => item.departure_airport && item.arrival_airport).map(flight), request.preferences);
    const options = [...trainOptions.slice(0, 4), ...flightOptions.slice(0, 3)].map((item) => ({ ...item, travel_date: date }));
    intercity.push({ from, to, date, queried_from: hubFrom, queried_to: hubTo, hub_note: describeTransportCity(to, hubTo) || describeTransportCity(from, hubFrom), recommended: options[0] || unavailable('train', !trainResult && !flightResult ? '城际交通查询失败，不能据此判断无票。' : '未查询到城际列车或航班。'), alternatives: options.slice(1, 5), options });
  }
  return { outbound, return: returning, return_next_day: nextDayReturn, intercity };
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

// 携程按“城市”返回首屏候选，而目的地往往只是该市的一个区（例如顺德属于佛山），
// 候选酒店会散布全市。这里用高德把“小红书推荐住宿范围”解析成坐标，
// 再按到该范围的距离重排，避免把行程附近的住宿推荐成几十公里外的酒店。
async function planHotels(request, evidence, adapters, warnings) {
  const stays = [];
  for (const window of stayWindows(request)) {
    const areaEvidence = evidence.stayAreas.find((item) => item.city === window.city); const area = areaEvidence?.name || `${window.city}市中心`;
    const result = await attempt(`携程${window.city}酒店查询失败`, warnings, () => adapters.inventory.searchHotels({ city: window.city, checkin: window.checkin, checkout: window.checkout, keyword: area, min_score: 4, limit: 20 }));
    const anchor = await attempt(`高德住宿区域“${window.city} ${area}”查询失败`, warnings, () => adapters.geo.searchPoi(`${window.city} ${area}`));
    const distanceKm = (item) => {
      const lon = numeric(item.lon); const lat = numeric(item.lat);
      if (!anchor?.location || lon === null || lat === null) return null;
      return Math.round(haversine(anchor.location, { lng: lon, lat }) * 10) / 10;
    };
    // 同一片区内的候选距离只差几百米，不该由浮点距离决定先后；
    // 先按公里分档，档内再比评分与价格，避免把 21.6 km 的酒店排在 21.8 km 之前。
    const distanceBand = (item) => item.distance_km == null ? Infinity : Math.round(item.distance_km);
    const options = [...(result?.results || [])].map((item) => ({ ...item, distance_km: distanceKm(item) }))
      .sort((a, b) => distanceBand(a) - distanceBand(b) || (numeric(b.score) || 0) - (numeric(a.score) || 0) || (numeric(a.price) || Infinity) - (numeric(b.price) || Infinity))
      .map((item) => ({
        ...item, city: window.city, area: item.district || area, xhs_area: area, price_per_night: item.price, rating: item.score,
        advantages: [item.distance_km == null ? `靠近小红书推荐住宿范围“${area}”` : `距小红书推荐住宿范围“${area}”约 ${item.distance_km} km`, '携程真实候选，价格和库存以下单页为准。'], images: [], provider: 'ctrip', truth: 'verified'
      }));
    for (const option of options.slice(0, 5)) {
      if (!adapters.inventory.getHotelDetail) break;
      const detail = await attempt(`携程酒店详情“${option.name}”查询失败`, warnings, () => adapters.inventory.getHotelDetail({ hotel_id: option.hotel_id }));
      if (detail?.result) Object.assign(option, { facilities: detail.result.facilities, check_in_out: detail.result.check_in_out, rating_breakdown: detail.result.rating_breakdown, introduction: [detail.result.facilities ? `设施：${detail.result.facilities}` : '', detail.result.check_in_out || ''].filter(Boolean).join('；') });
      if (adapters.inventory.getHotelImages) {
        const imageResult = await attempt(`携程酒店图片“${option.name}”查询失败`, warnings, () => adapters.inventory.getHotelImages({ hotel_id: option.hotel_id }));
        option.images = (imageResult?.results || []).map((image, index) => ({ url: image.image_url, caption: image.caption, source_post_url: image.source_url, source_image_index: index, provider: 'ctrip', confidence: 1 }));
      }
    }
    if (adapters.social.enrichImages && options.length) {
      const targets = options.slice(0, 5).map((option) => ({ id: `${window.city}-hotel-${option.hotel_id}`, name: option.name, kind: 'hotel' }));
      const material = await attempt(`小红书${window.city}酒店素材搜索失败`, warnings, () => adapters.social.enrichImages(window.city, targets));
      for (const image of material?.images || []) {
        const option = options.find((candidate) => `${window.city}-hotel-${candidate.hotel_id}` === image.target_id);
        if (option && !option.images.length) option.images = [{ ...image, source_note_id: image.sourceFeedId, source_image_index: image.sourceImageIndex }];
      }
      evidence.sources = [...new Map([...evidence.sources, ...(material?.sources || [])].map((source) => [source.feedId, source])).values()];
    }
    stays.push({ ...window, area, area_evidence: areaEvidence || null, recommended: options.slice(0, 2), alternatives: options.slice(2, 5) });
  }
  return { recommended_area: stays.map((item) => `${item.city}：${item.area}`).join('；'), reason: '住宿区域来自小红书多帖经验，具体酒店来自携程查询。', area_tips: stays.flatMap((item) => [...(item.area_evidence?.pros || []), ...(item.area_evidence?.cons || [])]).slice(0, 6), stays, recommended: stays.flatMap((item) => item.recommended), alternatives: stays.flatMap((item) => item.alternatives) };
}

async function stayAnchor(stay, adapters, warnings) {
  const hotel = stay.recommended[0];
  if (hotel && numeric(hotel.lon) !== null && numeric(hotel.lat) !== null) return { id: hotel.hotel_id, name: hotel.name, address: hotel.address, location: { lng: Number(hotel.lon), lat: Number(hotel.lat) }, provider: 'ctrip' };
  return attempt(`高德住宿区域“${stay.city} ${stay.area}”查询失败`, warnings, () => adapters.geo.searchPoi(`${stay.city} ${stay.area}`));
}

// 景点已按「离住宿锚点由近到远」排序，相邻条目通常在同一片区。
// 轮转发牌会把同片区的两个景点拆到不同天，却把相距十几公里的两个凑到同一天，
// 与“每天做空间聚类”的设计意图相反（实测顺德：清晖园与华盖路步行街仅相距约 300 m
// 却被分到两天，而金榜上街与渔人码头相距 13.6 km 被凑在同一天）。
// 改为均衡的连续分块：天数尽量均分，同时让相邻（同片区）的景点留在同一天。
function distribute(items, days, cap) {
  const buckets = Array.from({ length: days }, () => []);
  const usable = items.slice(0, days * cap);
  if (!usable.length) return buckets;
  const base = Math.floor(usable.length / days);
  const remainder = usable.length % days;
  let cursor = 0;
  for (let day = 0; day < days; day += 1) {
    const size = Math.min(cap, base + (day < remainder ? 1 : 0));
    buckets[day] = usable.slice(cursor, cursor + size);
    cursor += size;
  }
  return buckets;
}
function clock(totalMinutes) { return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(Math.round(totalMinutes % 60)).padStart(2, '0')}`; }
function haversine(a, b) { const rad = (value) => value * Math.PI / 180; const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng); const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }

async function routeLeg(from, to, adapters, warnings) {
  const value = await attempt(`高德路线 ${from.name} → ${to.name} 查询失败`, warnings, () => adapters.geo.route(from, to, 'driving'));
  if (!value) return { from: from.name, to: to.name, mode: 'driving', mode_label: '驾车 / 打车', unavailable: true, provider: 'amap', polyline: [] };
  const first = value.polyline?.[0]; const last = value.polyline?.at(-1);
  const startGap = first ? Math.round(haversine(location(from), { lng: Number(first[0]), lat: Number(first[1]) }) * 1000) : null;
  const endGap = last ? Math.round(haversine(location(to), { lng: Number(last[0]), lat: Number(last[1]) }) * 1000) : null;
  const gapStatus = startGap == null || endGap == null ? 'unavailable' : Math.max(startGap, endGap) > 300 ? 'fail' : Math.max(startGap, endGap) > 100 ? 'warn' : 'pass';
  if (gapStatus === 'fail') warnings.push(`高德路线 ${from.name} → ${to.name} 的端点与 POI 相距超过 300 米，请留意最后一段步行或入口位置。`);
  return { from: from.name, to: to.name, from_id: from.id, to_id: to.id, mode: 'driving', mode_label: '驾车 / 打车', distance_meters: value.distanceMeters, duration_minutes: value.durationMinutes, polyline: value.polyline, steps: value.steps || [], endpoint_validation: { start_gap_m: startGap, end_gap_m: endGap, status: gapStatus }, provider: 'amap', queried_at: timestamp(), truth: 'verified' };
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
      const firstDay = number === 1;
      // Daily sightseeing maps deliberately contain attractions only. Lodging,
      // arrival and transfer nodes remain in the timeline, never in geometry.
      const sequence = bucket.map((item) => item.poi); const legs = [];
      for (let index = 0; index < sequence.length - 1; index += 1) legs.push(await routeLeg(sequence[index], sequence[index + 1], adapters, warnings));
      const transfer = cityIndex > 0 && number === [...allocation.values()].slice(0, cityIndex).reduce((sum, value) => sum + value, 0) + 1 ? transport.intercity[cityIndex - 1]?.recommended : null;
      const timeline = [{ time: transfer?.departure_time || null, type: transfer ? 'transport' : 'hotel', title: transfer ? `${transfer.train_no || transfer.flight_no || (transfer.mode === 'flight' ? '城际航班' : '城际列车')}：${transfer.from} → ${transfer.to}` : firstDay ? `抵达并前往 ${anchor.name}` : `从 ${anchor.name} 出发`, place: anchor.name, coordinates: location(anchor), subtitle: transfer ? `${transport.intercity[cityIndex - 1]?.date || ''} ${transfer.departure_time || '—'} 出发，${transfer.arrival_time || '—'} 抵达；随后前往住宿` : firstDay ? '抵达、接驳、入住和休息' : '住宿 / 集合点' }];
      bucket.forEach((item) => timeline.push({ time: null, type: 'attraction', title: item.name, place: item.name, coordinates: item.coordinates, duration_minutes: item.recommended_duration_minutes, highlights: item.highlights.slice(0, 1), attraction_id: item.id, source_refs: item.source_refs, image: item.images?.[0] || null }));
      days.push({ day: number, date: dateAdd(request.trip.start_date, number - 1), city, theme: bucket.map((item) => item.name).join(' · ') || `${city}机动日`, stay_area: stay.area, timeline, route_legs: legs, attraction_count: bucket.length, map: { points: bucket.map((item, index) => ({ id: item.id, name: item.name, order: index + 1, role: bucket.length === 1 ? 'start' : index === 0 ? 'start' : index === bucket.length - 1 ? 'end' : 'waypoint', ...item.coordinates })), legs } });
      number += 1;
    }
  }
  return days;
}

export async function createTravelPlan(request, adapters) {
  const warnings = []; const guides = [];
  for (const city of request.trip.destinations) guides.push(await adapters.social.research(city, request));
  const evidence = await enrichMissingImages(socialEvidence(guides), adapters, warnings);
  if (adapters.social.researchPitfalls) {
    const researchedTips = [];
    for (const city of request.trip.destinations) {
      const result = await attempt(`小红书${city}踩坑提醒搜索失败`, warnings, () => adapters.social.researchPitfalls(city));
      researchedTips.push(...(result?.tips || [])); evidence.sources = [...new Map([...evidence.sources, ...(result?.sources || [])].map((source) => [source.feedId, source])).values()];
    }
    if (researchedTips.length) evidence.tips = researchedTips;
  }
  if (adapters.social.researchStayAreas) {
    for (const city of request.trip.destinations.filter((destination) => !evidence.stayAreas.some((item) => item.city === destination))) {
      const result = await attempt(`小红书${city}住宿范围搜索失败`, warnings, () => adapters.social.researchStayAreas(city));
      evidence.stayAreas.push(...(result?.areas || []).map((area) => ({ ...area, city }))); evidence.sources = [...new Map([...evidence.sources, ...(result?.sources || [])].map((source) => [source.feedId, source])).values()];
    }
  }
  const attractions = await verifyAttractions(evidence, adapters, warnings);
  if (!attractions.length) throw new Error('没有找到同时满足“小红书多帖共识”和“高德 POI 可验证”的景点。');
  const transport = await planTransport(request, adapters, warnings);
  const hotel = await planHotels(request, evidence, adapters, warnings);
  const days = await scheduleDays(request, attractions, hotel, transport, adapters, warnings);
  const source_registry = Object.fromEntries(evidence.sources.map((source) => [source.feedId, { source_id: source.feedId, platform: 'xiaohongshu', note_id: source.feedId, title: source.title, author: source.author, canonical_url: source.url, retrieved_url: source.url, retrieved_at: timestamp() }]));
  const plan = { trip: { ...request.trip, assumptions: request.assumptions }, travelers: request.travelers, preferences: request.preferences, constraints: request.constraints, transport, hotel, overview: { summary: `按用户输入顺序游玩${request.trip.destinations.join('、')}，每天仅对景点节点做空间聚类并用高德逐段验证。`, day_clusters: days.map((day) => ({ day: day.day, city: day.city, points: day.map.points.map((item) => item.name) })) }, days, attractions, foods: evidence.foods, practical_tips: evidence.tips, source_posts: evidence.sources, source_registry, metadata: { generated_at: timestamp(), mode: 'live', mode_label: 'LIVE · 分段校验编排', xhs_post_count: evidence.sources.length, xhs_query_time: timestamp(), ctrip_query_time: timestamp(), amap_query_time: timestamp(), warnings } };
  plan.validation = validateTravelPlan(plan);
  if (!plan.validation.valid) throw new Error(`旅行规划校验失败：${plan.validation.errors.join('；')}`);
  plan.metadata.warnings = plan.validation.warnings;
  return plan;
}
