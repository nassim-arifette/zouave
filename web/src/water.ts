import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map } from 'maplibre-gl';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import { config } from './config.ts';

type Polygons = FeatureCollection<Polygon | MultiPolygon>;
const MASK_SIZE = 4096;

function rings(feature: Polygons['features'][number]) {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}

export function createWaterLayer(data: Polygons): CustomLayerInterface & { rise: (progress: number) => void; enabled: boolean } {
  const origin = MercatorCoordinate.fromLngLat(config.initialCenter);
  const meter = origin.meterInMercatorCoordinateUnits();
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const point = (coordinate: Position) => {
    const mercator = MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]]);
    return new THREE.Vector2((mercator.x - origin.x) / meter, -(mercator.y - origin.y) / meter);
  };
  const bounds = new THREE.Box2();
  for (const feature of data.features) for (const polygon of rings(feature)) for (const c of polygon[0]) bounds.expandByPoint(point(c));
  bounds.expandByScalar(50);
  const extent = bounds.getSize(new THREE.Vector2());

  // Shore mask: water polygons minus building footprints, blurred, so foam gathers along banks and walls.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MASK_SIZE;
  const mask = new THREE.CanvasTexture(canvas);
  mask.colorSpace = THREE.NoColorSpace;
  const drawMask = (buildings?: Polygons) => {
    const ctx = canvas.getContext('2d')!;
    const scale = new THREE.Vector2(MASK_SIZE / extent.x, MASK_SIZE / extent.y);
    const layer = document.createElement('canvas'); layer.width = layer.height = MASK_SIZE;
    const lctx = layer.getContext('2d')!;
    lctx.fillStyle = '#000'; lctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    const drawSet = (target: CanvasRenderingContext2D, set: Polygons, color: string) => {
      target.fillStyle = color;
      for (const feature of set.features) {
        const polygons = rings(feature);
        target.beginPath();
        for (const polygon of polygons) for (const ring of polygon) ring.forEach((c, i) => {
          const p = point(c);
          const x = (p.x - bounds.min.x) * scale.x, y = MASK_SIZE - (p.y - bounds.min.y) * scale.y;
          if (i) target.lineTo(x, y); else target.moveTo(x, y);
        });
        target.fill('evenodd');
      }
    };
    drawSet(lctx, data, '#fff');
    if (buildings) drawSet(lctx, buildings, '#000');
    ctx.filter = 'blur(3px)';
    ctx.drawImage(layer, 0, 0);
    ctx.filter = 'none';
    mask.needsUpdate = true;
  };
  drawMask();
  void fetch('/data/batiments.geojson').then(r => r.ok ? r.json() : undefined).then(b => b && drawMask(b)).catch(() => {});

  const uniforms = {
    uTime: { value: 0 }, uRise: { value: 0 }, uMask: { value: mask },
    uBoundsMin: { value: bounds.min.clone() }, uBoundsSize: { value: extent.clone() },
    uEye: { value: new THREE.Vector3(0, 0, 1000) }, uExaggeration: { value: config.waterExaggeration },
  };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, uniforms,
    vertexShader: `
      uniform float uRise;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying float vFullDepth;
      void main() {
        vec3 p = position;
        vFullDepth = position.z;
        p.z *= uRise;
        vPosition = p;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime, uRise, uExaggeration;
      uniform sampler2D uMask;
      uniform vec2 uBoundsMin, uBoundsSize;
      uniform vec3 uEye;
      varying vec3 vPosition;
      varying vec3 vNormal;
      varying float vFullDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      // Slow downstream current (the Seine flows roughly towards the west-south-west here).
      float height(vec2 p) {
        vec2 flow = vec2(-0.9, -0.25) * uTime;
        return noise(p * 0.35 + flow * 0.35) * 0.5 + noise(p * 0.9 - flow * 0.5 + 7.0) * 0.25
             + noise(p * 2.3 + vec2(uTime * 0.6, -uTime * 0.9)) * 0.15 + noise(p * 5.7 + uTime * 1.3) * 0.08;
      }
      void main() {
        vec2 p = vPosition.xy;
        vec3 V = normalize(uEye - vPosition);
        float dist = length(uEye - vPosition);
        float shore = texture2D(uMask, (p - uBoundsMin) / uBoundsSize).r;
        float depthM = vFullDepth / uExaggeration * uRise;
        vec3 murk = vec3(0.12, 0.12, 0.08);
        vec3 shallow = vec3(0.24, 0.23, 0.15);
        if (vNormal.z < 0.5) {
          // Walls of the water body: dark silty cross-section with a bright meniscus at the surface.
          float below = clamp((vPosition.z) / max(vFullDepth * uRise, 0.001), 0.0, 1.0);
          vec3 c = mix(murk * 0.45, murk * 0.9, below);
          c = mix(c, vec3(0.74, 0.70, 0.58), smoothstep(0.92, 1.0, below) * 0.7);
          gl_FragColor = vec4(c, 0.9);
          return;
        }
        float e = 0.12;
        float fade = clamp(60.0 / dist, 0.15, 1.0);
        vec2 g = vec2(height(p + vec2(e, 0)) - height(p - vec2(e, 0)), height(p + vec2(0, e)) - height(p - vec2(0, e))) / (2.0 * e);
        vec3 n = normalize(vec3(-g * 0.55 * fade, 1.0));
        float cosV = max(dot(n, V), 0.0);
        float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
        vec3 R = reflect(-V, n);
        vec3 zenith = vec3(0.30, 0.38, 0.45), horizon = vec3(0.62, 0.66, 0.66);
        vec3 sky = mix(horizon, zenith, smoothstep(0.0, 0.6, R.z));
        vec3 sun = normalize(vec3(-0.5, 0.35, 0.55));
        float spec = pow(max(dot(R, sun), 0.0), 220.0) * 2.5 + pow(max(dot(R, sun), 0.0), 18.0) * 0.12;
        float depthMix = 1.0 - exp(-depthM * 1.4);
        vec3 body = mix(shallow, murk, depthMix);
        body *= 0.9 + 0.2 * noise(p * 0.05 + uTime * 0.02);
        vec3 color = mix(body, sky * 0.8, fresnel * 0.6) + vec3(1.0, 0.95, 0.85) * spec * 0.6;
        float edge = 1.0 - smoothstep(0.35, 0.9, shore);
        float foamNoise = noise(p * 1.7 + vec2(-0.9, -0.25) * uTime * 0.6) * noise(p * 4.3 - uTime * 0.3);
        float foam = edge * smoothstep(0.12, 0.35, foamNoise + edge * 0.25);
        float streaks = smoothstep(0.78, 0.95, noise(vec2(p.x * 0.08, p.y * 0.6) + vec2(-0.9, -0.25) * uTime * 0.1)) * 0.25;
        color = mix(color, vec3(0.80, 0.76, 0.64), clamp(foam * 0.75 + streaks * fade, 0.0, 0.85));
        float alpha = mix(0.72, 0.94, depthMix) + fresnel * 0.08;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `,
  });
  const geometries: THREE.BufferGeometry[] = [];
  for (const feature of data.features) {
    for (const polygon of rings(feature)) {
      const shape = new THREE.Shape(polygon[0].map(point));
      for (const hole of polygon.slice(1)) shape.holes.push(new THREE.Path(hole.map(point)));
      geometries.push(new THREE.ExtrudeGeometry(shape, { depth: Number(feature.properties?.h_vis ?? 1) * config.waterExaggeration, bevelEnabled: false, steps: 1, curveSegments: 1 }));
    }
  }
  const merged = mergeGeometries(geometries, false);
  geometries.forEach(geometry => geometry.dispose());
  if (!merged) throw new Error('Water geometry could not be merged');
  const mesh = new THREE.Mesh(merged, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let renderer: THREE.WebGLRenderer;
  let map: Map;
  const transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(meter, -meter, meter));
  const clip = new THREE.Matrix4();
  const eyeSystem = new THREE.Matrix3();
  const layer: CustomLayerInterface & { rise: (progress: number) => void; enabled: boolean } = {
    id: 'water-shader', type: 'custom', renderingMode: '3d', enabled: false,
    rise(progress) { uniforms.uRise.value = progress; map?.triggerRepaint(); },
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
      if (!layer.enabled || uniforms.uRise.value <= 0) return;
      uniforms.uTime.value = performance.now() / 1000;
      clip.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
      camera.projectionMatrix.copy(clip);
      // Eye position in layer metres: the point whose clip-space x, y and w are all zero.
      const m = clip.elements;
      eyeSystem.set(m[0], m[4], m[8], m[1], m[5], m[9], m[3], m[7], m[11]);
      uniforms.uEye.value.set(-m[12], -m[13], -m[15]).applyMatrix3(eyeSystem.invert());
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
      map.triggerRepaint();
    },
    onRemove() { merged.dispose(); material.dispose(); mask.dispose(); renderer?.dispose(); },
  };
  return layer;
}
