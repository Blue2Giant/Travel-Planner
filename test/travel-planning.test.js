import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTravelPlan } from '../src/travel-plan/orchestrator.js';
import { parseTravelRequest } from '../src/travel-plan/requirements.js';
import { renderTravelPlan } from '../src/travel-plan/report.js';

const source = (city, id) => ({ feedId: id, title: `${city}攻略`, author: '测试作者', url: `https://www.xiaohongshu.com/explore/${id}`, images: [`https://img.example/${id}.jpg`] });
const guide = (city) => ({
  destination: city,
  highlights: [
    { name: `${city}景点甲`, description: `${city}代表景点甲`, sources: [`${city}-1`, `${city}-2`], images: [] },
    { name: `${city}景点乙`, description: `${city}代表景点乙`, sources: [`${city}-2`, `${city}-3`], images: [] }
  ],
  food: [{ name: `${city}美食`, reason: '当地特色', sources: [`${city}-1`], images: [] }],
  stayAreas: [{ name: `${city}古城附近`, goodFor: '首次到访', pros: ['靠近活动区'], cons: [], sources: [`${city}-1`, `${city}-2`], images: [] }],
  tips: [{ text: `${city}出发前复核预约`, sources: [`${city}-1`, `${city}-2`] }],
  sources: [source(city, `${city}-1`), source(city, `${city}-2`), source(city, `${city}-3`)]
});

function adapters() {
  let poiIndex = 0;
  return {
    social: { research: async (city) => guide(city) },
    inventory: {
      searchFlights: async ({ origin, destination }) => ({ results: [{ airline: '测试航空', departure_time: '09:00', arrival_time: '12:00', departure_airport: origin, arrival_airport: destination, price: 900, duration: '3小时', source_url: 'https://ctrip.example/flight' }] }),
      searchTrains: async ({ origin, destination }) => ({ results: [{ train_no: 'G123', departure_time: '10:00', arrival_time: '12:00', departure_station: origin, arrival_station: destination, from_price: 180, duration: '2小时', source_url: 'https://ctrip.example/train' }] }),
      searchHotels: async ({ city }) => ({ results: [{ hotel_id: `${city}-hotel`, name: `${city}测试酒店`, address: `${city}中心`, district: '中心区', lon: 100 + poiIndex * 0.01, lat: 27 + poiIndex * 0.01, price: 520, score: 4.8, source_url: 'https://ctrip.example/hotel' }] })
    },
    geo: {
      searchPoi: async (name) => { poiIndex += 1; return { id: `poi-${poiIndex}`, name, address: '测试地址', citycode: '000', location: { lng: 100 + poiIndex * 0.02, lat: 27 + poiIndex * 0.02 }, provider: 'amap' }; },
      route: async (from, to) => ({ distanceMeters: 3600, durationMinutes: 18, polyline: [[from.location.lng, from.location.lat], [to.location.lng, to.location.lat]], steps: [{ instruction: '沿测试道路行驶', distanceMeters: 3600 }] })
    }
  };
}

const request = { origin: '北京', destination: ['香格里拉', '丽江'], start_date: '2026-10-02', end_date: '2026-10-07', preferences: { pace: 'relaxed', avoid_early_morning: true } };

test('parses the Beijing multi-city test request', () => {
  const parsed = parseTravelRequest(request);
  assert.equal(parsed.trip.origin, '北京');
  assert.deepEqual(parsed.trip.destinations, ['香格里拉', '丽江']);
  assert.equal(parsed.trip.days, 6);
  assert.equal(parsed.trip.nights, 5);
});

test('builds a source-backed plan with Ctrip inventory and AMap route geometry', async () => {
  const plan = await buildTravelPlan(request, { adapters: adapters() });
  assert.equal(plan.days.length, 6);
  assert.equal(plan.transport.outbound.recommended.provider, 'ctrip');
  assert.equal(plan.hotel.stays.length, 2);
  assert.ok(plan.hotel.recommended.every((hotel) => hotel.provider === 'ctrip'));
  assert.ok(plan.attractions.every((item) => item.support_count >= 2 && item.poi.provider === 'amap'));
  assert.ok(plan.days.flatMap((day) => day.route_legs).every((leg) => leg.provider === 'amap' && leg.polyline.length >= 2));
  assert.ok(plan.attractions.every((item) => item.images.length === 0));
  assert.equal(plan.validation.valid, true);
});

test('renders interactive AMap containers and clickable route detail controls', async () => {
  const plan = await buildTravelPlan(request, { adapters: adapters() });
  const html = renderTravelPlan(plan, { amapJsKey: 'test-key', securityJsCode: 'test-code' });
  assert.equal((html.match(/class="amap day-map"/g) || []).length, 6);
  assert.match(html, /id="overview-map"/);
  assert.match(html, /class="leg-button"/);
  assert.match(html, /route-drawer/);
  assert.match(html, /webapi\.amap\.com\/maps/);
  assert.match(html, /景点图鉴与帖子配图/);
  assert.match(html, /image-lightbox/);
  assert.match(html, /dblclick/);
});
