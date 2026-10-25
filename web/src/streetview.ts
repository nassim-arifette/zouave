// Street View (Maps JavaScript API) with our flood water drawn on a transparent Three.js canvas above the official,
// unmodified panorama. Opened in an opaque panel (no MapLibre map on the same screen), attribution untouched, no depth:
// the water is a flat plane at a fixed camera height, following the panorama's point of view and the height slider.
import * as THREE from 'three';

export const CAMERA_HEIGHT_M = 2.5;
export const MAX_LEVEL = 3;

/** Street View zoom → horizontal field of view in degrees (zoom 0 = 180°, each level halves it). */
export function fovForZoom(zoom: number) { return Math.min(170, Math.max(10, 180 / Math.pow(2, zoom))); }
/** Great-circle bearing from the panorama to the address, so the camera faces the façade. */
export function headingTo(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const r = Math.PI / 180, dLng = (to.lng - from.lng) * r;
  const y = Math.sin(dLng) * Math.cos(to.lat * r), x = Math.cos(from.lat * r) * Math.sin(to.lat * r) - Math.sin(from.lat * r) * Math.cos(to.lat * r) * Math.cos(dLng);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
/** Great-circle distance in metres between two coordinates (no Maps JS geometry library needed). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}
/** Above CAMERA_HEIGHT_M the camera is under the surface: the plane is seen from below (double-sided) and the view is tinted. */
export function waterAppearance(heightM: number, cameraHeight = CAMERA_HEIGHT_M) {
  const level = Math.min(MAX_LEVEL, Math.max(0, heightM));
  const submerged = level > cameraHeight;
  return { visible: level > 0, submerged, tintAlpha: submerged ? Math.min(0.75, 0.45 + (level - cameraHeight) * 0.6) : 0 };
}
/** Vertical position of the water plane relative to the camera for a water height above the ground (m). */
export function waterPlaneY(heightM: number, cameraHeight = CAMERA_HEIGHT_M) { return Math.min(MAX_LEVEL, Math.max(0, heightM)) - cameraHeight; }

export function createWaterOverlay(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(90, 16 / 9, 0.1, 500);
  const material = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, transparent: true, opacity: 0.82, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600, 64, 64), material);
  water.rotation.x = -Math.PI / 2; water.position.y = waterPlaneY(0);
  scene.add(water, new THREE.HemisphereLight(0xcfe3ec, 0x3a2f20, 1.2), new THREE.DirectionalLight(0xfff4e0, 0.8));
  const positions = water.geometry.attributes.position as THREE.BufferAttribute;
  const base = Float32Array.from(positions.array as Float32Array);
  let frame = 0, level = 0, pov = { heading: 0, pitch: 0, zoom: 1 };
  const resize = () => { const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const tick = (time: number) => {
    frame = requestAnimationFrame(tick);
    // gentle ripples
    for (let i = 0; i < positions.count; i++) { const x = base[i * 3], y = base[i * 3 + 1]; positions.setZ(i, level > 0 ? 0.03 * Math.sin(x * 0.4 + time / 700) * Math.cos(y * 0.3 + time / 900) : 0); }
    positions.needsUpdate = true; water.geometry.computeVertexNormals();
    camera.fov = 2 * Math.atan(Math.tan(fovForZoom(pov.zoom) * Math.PI / 360) / camera.aspect) * 180 / Math.PI;
    camera.rotation.set(pov.pitch * Math.PI / 180, -pov.heading * Math.PI / 180, 0, 'YXZ');
    camera.updateProjectionMatrix();
    const look = waterAppearance(level);
    water.visible = look.visible;
    renderer.setClearColor(0x3b2f1c, look.tintAlpha);
    renderer.render(scene, camera);
  };
  resize(); frame = requestAnimationFrame(tick);
  return {
    setLevel(heightM: number) { level = Math.min(MAX_LEVEL, Math.max(0, heightM)); water.position.y = waterPlaneY(level); },
    setPov(next: { heading: number; pitch: number; zoom: number }) { pov = next; },
    resize,
    dispose() { cancelAnimationFrame(frame); renderer.dispose(); water.geometry.dispose(); material.dispose(); },
  };
}

declare const google: any;
let mapsLoading: Promise<void> | undefined;
function loadMapsJs(key: string) {
  mapsLoading ??= new Promise<void>((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps?.StreetViewPanorama) { resolve(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: 'weekly', loading: 'async', callback: '__zouaveMaps' })}`;
    (globalThis as any).__zouaveMaps = () => resolve();
    script.onerror = () => { mapsLoading = undefined; reject(new Error('Maps JavaScript API indisponible.')); };
    document.head.append(script);
  });
  return mapsLoading;
}

/** Opens the official panorama nearest to `address` (≤ radius m), facing the façade, with the water overlay. */
export async function openStreetView(elements: { panorama: HTMLElement; canvas: HTMLCanvasElement; status: HTMLElement }, address: { lat: number; lng: number }, options: { key: string; radius?: number; level: number }) {
  elements.status.hidden = false; elements.status.textContent = 'Loading Street View…';
  await loadMapsJs(options.key);
  const service = new google.maps.StreetViewService();
  const { data } = await service.getPanorama({ location: address, radius: options.radius ?? 60, source: google.maps.StreetViewSource.OUTDOOR, preference: google.maps.StreetViewPreference.NEAREST });
  const camera = data.location.latLng; const from = { lat: camera.lat(), lng: camera.lng() };
  const heading = headingTo(from, address);
  const panorama = new google.maps.StreetViewPanorama(elements.panorama, { pano: data.location.pano, pov: { heading, pitch: 0 }, zoom: 1, addressControl: true, linksControl: false, panControl: true, enableCloseButton: false, motionTracking: false, fullscreenControl: false, showRoadLabels: true });
  const overlay = createWaterOverlay(elements.canvas);
  overlay.setLevel(options.level);
  const sync = () => { const pov = panorama.getPov(); overlay.setPov({ heading: pov.heading, pitch: pov.pitch, zoom: panorama.getZoom() ?? 1 }); };
  panorama.addListener('pov_changed', sync); panorama.addListener('zoom_changed', sync); sync();
  elements.status.hidden = true;
  return { panorama, overlay, distance_m: Math.round(distanceM(from, address)), copyright: String(data.copyright ?? '© Google'), close() { overlay.dispose(); panorama.setVisible(false); } };
}
