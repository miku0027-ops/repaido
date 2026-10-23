type Point = {lat: number; lng: number};

/** A projected overlay: the foot of the pin stays on the selected coordinate
 * while its head drops in. Panning never changes the chosen pickup point. */
export function rideLocationMarker(maps: any, map: any, point: Point, stop: 'pickup' | 'dropoff') {
 const overlay = new maps.OverlayView();
 const node = document.createElement('div');
 node.className = `go-map-pin go-map-pin--${stop}`;
 node.setAttribute('aria-hidden', 'true');
 node.innerHTML = '<span class="go-map-pin-ring"></span><span class="go-map-pin-foot"></span><span class="go-map-pin-head"><svg viewBox="0 0 56 76" width="56" height="76" fill="none"><path d="M28 72C25 58 5 43 5 27a23 23 0 0 1 46 0c0 16-20 31-23 45Z" fill="currentColor" stroke="white" stroke-width="3"/><circle cx="28" cy="27" r="10" fill="#202124"/><circle cx="28" cy="27" r="4" fill="white"/></svg></span>';
 overlay.onAdd = () => overlay.getPanes().overlayMouseTarget.appendChild(node);
 overlay.draw = () => {
  const pixel = overlay.getProjection().fromLatLngToDivPixel(new maps.LatLng(point.lat, point.lng));
  if (pixel) {node.style.left = `${pixel.x}px`; node.style.top = `${pixel.y}px`;}
 };
 overlay.onRemove = () => node.remove();
 overlay.setMap(map);
 return overlay;
}
