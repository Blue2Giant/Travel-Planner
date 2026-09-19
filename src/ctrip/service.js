import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { airportCode } from './airport-codes.js';
import { runOpencli } from './opencli.js';

const root = path.resolve('data/raw/ctrip');
const asList = (value) => Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : Array.isArray(value?.results) ? value.results : Array.isArray(value?.list) ? value.list : [];
const num = (value) => { const result = Number(String(value ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(result) ? result : null; };
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
  const raw = await query('flights', 'flight', [origin, destination, '--date', input.date, '--limit', String(input.limit || 10)], input);
  let results = asList(raw).map((item) => ({ airline: field(item, 'airline', 'airlineName'), flight_no: field(item, 'flightNo', 'flight_no') || null, aircraft: field(item, 'aircraft') || null, departure_time: field(item, 'departureTime', 'departTime'), departure_airport: field(item, 'departureAirport', 'departureAirportName'), arrival_time: field(item, 'arrivalTime', 'arriveTime'), arrival_airport: field(item, 'arrivalAirport', 'arrivalAirportName'), terminal: field(item, 'terminal', 'arrivalTerminal') || null, price: num(field(item, 'price', 'adultPrice', 'fromPrice')), currency: currency(item), cabin: field(item, 'cabin', 'cabinClass') || null, source_url: url(item) }));
  if (input.max_price != null) results = results.filter((item) => item.price !== null && item.price <= input.max_price);
  if (input.sort_by === 'price') results.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  return { ...meta({ ...input, origin_code: origin, destination_code: destination }), results: limit(results, input) };
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
  if (input.keyword) results = results.filter((item) => `${item.name} ${item.district} ${item.address}`.includes(input.keyword));
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
export async function hotelDetail(input) { const raw = await query('hotel-detail', 'hotel', [input.hotel_id], input); return { ...meta(input), result: raw, note: '详情不包含完整实时房型价格列表。' }; }
export async function roundtripFlights(input) { const origin = airportCode(input.origin); const destination = airportCode(input.destination); const raw = await query('roundtrip-flights', 'flight-round', [origin, destination, '--depart', input.depart_date, '--return', input.return_date, '--limit', String(input.limit || 10)], input); return { ...meta({ ...input, origin_code: origin, destination_code: destination }), results: limit(asList(raw), input), return_leg_complete: false, note: '当前 OpenCLI 携程 adapter 返回去程候选及往返总价，返程具体航班尚未完整解析。' }; }
