import { amapGet, durationOf, number, polylineOf } from './utils.js';

export async function getDrivingRoute(origin, destination, key) {
  const data = await amapGet('/v5/direction/driving', {
    key, origin: `${origin.location.lng},${origin.location.lat}`,
    destination: `${destination.location.lng},${destination.location.lat}`,
    origin_id: origin.id, destination_id: destination.id, strategy: 32, show_fields: 'cost,polyline'
  });
  const route = data.route || data.data?.route || {};
  const path = (route.paths || route.path || [])[0];
  if (!path) throw new Error('DRIVING_ROUTE_NOT_FOUND');
  const steps = path.steps || [];
  return {
    mode: 'driving', distanceMeters: number(path.distance), durationSeconds: durationOf(path),
    durationMinutes: Math.round(durationOf(path) / 60), tolls: number(path.tolls || path.cost?.tolls),
    trafficLights: number(path.traffic_lights),
    steps: steps.map((step) => ({
      instruction: step.instruction || '', roadName: step.road || step.road_name || '',
      distanceMeters: number(step.distance), durationSeconds: durationOf(step), polyline: polylineOf(step)
    })),
    polyline: polylineOf(path)
  };
}
