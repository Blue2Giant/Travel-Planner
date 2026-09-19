import { amapGet, durationOf, number, polylineOf } from './utils.js';

function station(stop) {
  const [lng, lat] = String(stop?.location || '').split(',').map(Number);
  return { name: stop?.name || '', location: Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null };
}

function walkingSegment(walking) {
  return {
    type: 'walk', lineName: '步行', lineType: '', from: '', to: '', fromLocation: null, toLocation: null,
    viaStops: [], viaNum: 0, distanceMeters: number(walking.distance), durationSeconds: durationOf(walking),
    polyline: polylineOf(walking), steps: (walking.steps || []).map((step) => ({
      instruction: step.instruction || '', roadName: step.road || '', distanceMeters: number(step.distance),
      durationSeconds: durationOf(step), polyline: polylineOf(step)
    }))
  };
}

function lineSegment(raw, type) {
  const from = station(raw.departure_stop || raw.from);
  const to = station(raw.arrival_stop || raw.to);
  const viaStops = (raw.via_stops || raw.viaStops || []).map(station).filter((item) => item.name);
  return {
    type, lineName: raw.name || raw.trip || raw.railway_name || (type === 'railway' ? '铁路' : '公共交通'),
    lineType: raw.type || raw.type_name || '', from: from.name, to: to.name,
    fromLocation: from.location, toLocation: to.location, viaStops,
    viaNum: number(raw.via_num) || viaStops.length, distanceMeters: number(raw.distance),
    durationSeconds: durationOf(raw), polyline: polylineOf(raw), steps: []
  };
}

function classifyBus(line) {
  const descriptor = `${line.name || ''} ${line.type || ''}`.toLowerCase();
  return /地铁|轨道交通|号线|metro|subway|轻轨|磁浮|磁悬浮/.test(descriptor) ? 'subway' : 'bus';
}

function expandSegment(segment) {
  const items = [];
  if (segment.walking || segment.walk) items.push(walkingSegment(segment.walking || segment.walk));
  if (segment.bus) {
    const lines = segment.bus.buslines || (segment.bus.name ? [segment.bus] : []);
    lines.forEach((line) => items.push(lineSegment(line, classifyBus(line))));
  }
  if (segment.railway) items.push(lineSegment(segment.railway, 'railway'));
  if (segment.taxi) items.push(lineSegment(segment.taxi, 'taxi'));
  return items;
}

export async function getTransitRoute(origin, destination, key) {
  const data = await amapGet('/v5/direction/transit/integrated', {
    key, origin: `${origin.location.lng},${origin.location.lat}`, destination: `${destination.location.lng},${destination.location.lat}`,
    originpoi: origin.id, destinationpoi: destination.id, city1: origin.citycode, city2: destination.citycode, show_fields: 'cost,polyline'
  });
  const route = data.route || data.data?.route || {};
  const transit = (route.transits || route.paths || route.transit || [])[0];
  if (!transit) throw new Error('TRANSIT_ROUTE_NOT_FOUND');
  const segments = (transit.segments || []).flatMap(expandSegment);
  return {
    mode: 'transit', distanceMeters: number(transit.distance), durationSeconds: durationOf(transit),
    durationMinutes: Math.round(durationOf(transit) / 60), fare: transit.cost?.fare ?? transit.cost ?? transit.fare,
    segments, polyline: segments.flatMap((item) => item.polyline)
  };
}
