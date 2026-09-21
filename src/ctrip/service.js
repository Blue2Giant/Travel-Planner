import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { airportCode } from './airport-codes.js';
import { readFlightCardsWithBrowser, runOpencli } from './opencli.js';

const root = path.resolve('data/raw/ctrip');
const asList = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.results) ? value.results : Array.isArray(value?.list) ? value.list : [];
const num = (value) => { if (value === null || value === undefined || String(value).trim() === '') return null; const result = Number(String(value).replace(/[^\d.]/g, '')); return Number.isFinite(result) ? result : null; };
const field = (item, ...keys) => keys.map((key) => item?.[key]).find((value) => value !== undefined && value !== null && value !== '');
const url = (item) => field(item, 'url', 'sourceUrl', 'source_url', 'link') || null;
const currency = (item) => { const value = field(item, 'currency'); return ['¥', '￥', 'RMB', 'CN¥'].includes(value) ? 'CNY' : value || 'CNY'; };
const iso = () => new Date().toISOString();
const stamp = (name) => `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.json`;

async function persist(kind, query, raw) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, stamp(kind)), JSON.stringify({ source: 'ctrip_opencli', queried_at: iso(), query, raw }, null, 2));
}
async function query(kind, command, args, input) { const raw = await runOpencli(command, args); await persist(kind, input, raw); return raw; }
function meta(query) { return { source: 'ctrip_opencli', query, queried_at: iso(), price_may_change: true }; }
function limit(items, input) { return items.slice(0, Math.min(Number(input.limit || 10), 20)); }

export async function flights(input) {
  const origin = airportCode(input.origin); const destination = airportCode(input.destination);
  let raw;
  try {
    raw = await runOpencli('flight', [origin, destination, '--date', input.date, '--limit', String(input.limit || 10)], { timeoutMs: 25_000, retries: 0 });
    await persist('flights', input, raw);
  } catch (error) {
    if (error.code !== 'TIMEOUT' && !/did not render flight cards|state=timeout/i.test(error.message || '')) throw error;
    const searchUrl = `https://flights.ctrip.com/online/list/oneway-${origin.toLowerCase()}-${destination.toLowerCase()}?depdate=${input.date}&cabin=Y_S_C_F&adult=1&child=0&infant=0`;
    const cards = await readFlightCardsWithBrowser(searchUrl, input.limit || 10);
    raw = cards.map((text, index) => parseFlightCard(text, searchUrl, index));
    await persist('flights-browser-fallback', input, raw);
  }
  let results = asList(raw).map((item) => { const rawAirline = field(item, 'airline', 'airlineName'); const overnight = /^\+\d+天$/.test(String(field(item, 'arrivalAirport', 'arrivalAirportName') || '')); return { airline: rawAirline ? String(rawAirline).replace(/\s*[A-Z0-9]{2}\d{3,4}.*$/i, '').trim() : rawAirline, flight_no: field(item, 'flightNo', 'flight_no') || null, aircraft: field(item, 'aircraft') || null, departure_time: field(item, 'departureTime', 'departTime'), arrival_time: field(item, 'arrivalTime', 'arriveTime'), duration: overnight ? '24小时' : field(item, 'duration'), departure_airport: field(item, 'departureAirport', 'departureAirportName'), arrival_airport: overnight ? `${input.destination}机场` : field(item, 'arrivalAirport', 'arrivalAirportName'), terminal: field(item, 'terminal', 'arrivalTerminal') || null, price: num(field(item, 'price', 'adultPrice', 'fromPrice')), currency: currency(item), cabin: field(item, 'cabin', 'cabinClass') || null, source_url: url(item) }; });
  if (input.max_price != null) results = results.filter((item) => item.price !== null && item.price <= input.max_price);
  if (input.sort_by === 'price') results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { ...meta({ ...input, origin_code: origin, destination_code: destination }), results: limit(results, input) };
}

function parseFlightCard(text, sourceUrl, index) {
  const lines = String(text || '').split(/\n+/).map((value) => value.trim()).filter(Boolean);
  const times = lines.map((value, lineIndex) => (/^\d{1,2}:\d{2}$/.test(value) ? lineIndex : -1)).filter((value) => value >= 0);
  const departureIndex = times[0]; const arrivalIndex = times[1];
  const details = departureIndex > 0 ? lines.slice(0, departureIndex).join(' ') : lines.join(' ');
  const flightNo = details.match(/\b[A-Z0-9]{2}\d{3,4}[A-Z]?\b/i)?.[0] || null;
  const aircraft = details.match(/(?:空客|波音|商飞)[^\s]*/)?.[0] || null;
  const price = String(text || '').match(/[¥￥]\s*([\d,]+(?:\.\d+)?)/)?.[1]?.replace(/,/g, '') || null;
  return {
    rank: index + 1,
    airline: lines[0] || null,
    flightNo,
    aircraft,
    departureTime: departureIndex >= 0 ? lines[departureIndex] : null,
    departureAirport: departureIndex >= 0 ? lines[departureIndex + 1] || null : null,
    arrivalTime: arrivalIndex >= 0 ? lines[arrivalIndex] : null,
    arrivalAirport: arrivalIndex >= 0 ? lines[arrivalIndex + 1] || null : null,
    price,
    currency: 'CNY',
    cabin: lines.find((value) => /舱/.test(value)) || null,
    url: sourceUrl
  };
}
export async function trains(input) {
  const raw = await query('trains', 'train', [input.origin, input.destination, '--date', input.date, '--limit', String(input.limit || 20)], input);
  let results = asList(raw).map((item) => { const trainNo = field(item, 'trainNo', 'train_no') || ''; return { train_no: trainNo, train_type: trainNo.charAt(0) || null, departure_time: field(item, 'departureTime', 'departTime'), arrival_time: field(item, 'arrivalTime', 'arriveTime'), departure_station: field(item, 'departureStation', 'fromStation'), arrival_station: field(item, 'arrivalStation', 'toStation'), duration: field(item, 'duration'), from_price: num(field(item, 'fromPrice', 'price')), currency: currency(item), seat_availability: field(item, 'seats', 'seatAvailability') || null, source_url: url(item) }; });
  if (input.train_types?.length) results = results.filter((item) => input.train_types.includes(item.train_type));
  return { ...meta(input), results: limit(results, input) };
}
function findCityId(raw) {
  const candidates = asList(raw); const candidate = candidates.find((item) => field(item, 'cityId', 'city_id')) || raw;
  return field(candidate, 'cityId', 'city_id');
}
export async function hotels(input) {
  const cityRaw = await query('hotel-city', 'search', [input.city, '--limit', '10'], { city: input.city });
  const cityId = findCityId(cityRaw);
  if (!cityId) { const error = new Error(`未能解析“${input.city}”的携程城市 ID。`); error.code = 'INVALID_CITY'; throw error; }
  const raw = await query('hotels', 'hotel-search', [String(cityId), '--checkin', input.checkin, '--checkout', input.checkout, '--limit', String(input.limit || 10)], input);
  let results = asList(raw).map((item) => ({ hotel_id: String(field(item, 'hotelId', 'hotel_id', 'id') || ''), name: field(item, 'name', 'hotelName'), en_name: field(item, 'enName', 'englishName') || null, star: num(field(item, 'star', 'starRating')), score: num(field(item, 'score', 'rating')), score_label: field(item, 'scoreLabel', 'ratingText') || null, review_count: num(field(item, 'reviewCount', 'commentCount')), city_name: field(item, 'cityName') || input.city, district: field(item, 'district', 'areaName') || null, address: field(item, 'address') || null, lat: num(field(item, 'lat', 'latitude')), lon: num(field(item, 'lon', 'longitude')), price: num(field(item, 'price', 'fromPrice')), currency: currency(item), source_url: url(item) }));
  if (input.keyword) {
    const matched = results.filter((item) => `${item.name} ${item.district} ${item.address}`.includes(input.keyword));
    if (matched.length) results = matched;
  }
  if (input.min_star != null) results = results.filter((item) => item.star !== null && item.star >= input.min_star);
  if (input.min_score != null) results = results.filter((item) => item.score !== null && item.score >= input.min_score);
  if (input.max_price != null) results = results.filter((item) => item.price !== null && item.price <= input.max_price);
  return { ...meta({ ...input, city_id: String(cityId) }), results: limit(results, input), note: '酒店结果来自携程首屏列表，并非携程全量库存；价格为查询日期下的代表报价。' };
}
export async function resolveHotelCity(input) {
  const raw = await query('hotel-city', 'search', [input.city, '--limit', '10'], input);
  const results = asList(raw).map((item) => ({ city_id: field(item, 'cityId', 'city_id') || null, name: field(item, 'name', 'cityName', 'keyword') || null, source_url: url(item) })).filter((item) => item.city_id);
  return { ...meta(input), results };
}
export async function hotelDetail(input) { const raw = await query('hotel-detail', 'hotel', [input.hotel_id], input); const item = asList(raw)[0] || raw || {}; return { ...meta(input), result: { hotel_id: String(field(item, 'hotelId', 'hotel_id') || input.hotel_id), name: field(item, 'name', 'hotelName') || null, facilities: field(item, 'facilities') || null, check_in_out: field(item, 'checkInOut') || null, rating_breakdown: field(item, 'ratingBreakdown') || null, review_count: num(field(item, 'reviewCount')), score: num(field(item, 'score')), source_url: url(item) }, note: '详情不包含完整实时房型价格列表。' }; }
export async function hotelImages(input) {
  const sourceUrl = `https://hotels.ctrip.com/hotels/detail/?hotelid=${encodeURIComponent(input.hotel_id)}`;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`携程酒店图片页请求失败（HTTP ${response.status}）。`);
  const html = await response.text(); const urls = [...html.matchAll(/https?:[^"'\s]+\.(?:jpg|jpeg|webp)/gi)].map((match) => match[0].replace(/\\u002F/g, '/')).filter((value) => /c-ctrip\.com\/images\//.test(value) && /_W_(?:1280|750|640|550|480)_/i.test(value));
  const images = [...new Set(urls)].slice(0, 3).map((image_url, index) => ({ image_url, caption: index === 0 ? '携程酒店详情主图' : `携程酒店详情图片 ${index + 1}`, source_url: sourceUrl, provider: 'ctrip' }));
  await persist('hotel-images', input, { sourceUrl, images }); return { ...meta(input), results: images };
}
export async function roundtripFlights(input) { const origin = airportCode(input.origin); const destination = airportCode(input.destination); const raw = await query('roundtrip-flights', 'flight-round', [origin, destination, '--depart', input.depart_date, '--return', input.return_date, '--limit', String(input.limit || 10)], input); return { ...meta({ ...input, origin_code: origin, destination_code: destination }), results: limit(asList(raw), input), return_leg_complete: false, note: '当前 OpenCLI 携程 adapter 返回去程候选及往返总价，返程具体航班尚未完整解析。' }; }
