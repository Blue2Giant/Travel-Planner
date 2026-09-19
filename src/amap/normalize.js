export function publicPlace(place) {
  return { name: place.name, address: place.address, lng: place.location.lng, lat: place.location.lat };
}
