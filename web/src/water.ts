import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map } from 'maplibre-gl';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { config } from './config.ts';

export function createWaterLayer(data: FeatureCollection<Polygon | MultiPolygon>): CustomLayerInterface & { rise: (progress: number) => void; enabled: boolean } {
  const origin = MercatorCoordinate.fromLngLat(config.initialCenter);
  const meter = origin.meterInMercatorCoordinateUnits();
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const uniforms = { uTime: { value: 0 }, uRise: { value: 0 }, uOpacity: { value: 0.76 } };
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, uniforms,
    vertexShader: `
      uniform float uTime;
      uniform float uRise;
      varying vec3 vPosition;
      varying vec3 vNormal;
      void main() {
        vec3 p = position;
        p.z *= uRise;
        float top = step(0.5, normal.z);
        float ripple = sin(p.x * 0.11 + uTime * 0.7) * cos(p.y * 0.09 - uTime * 0.5);
        p.z += top * ripple * 0.08 * uRise;
        vPosition = p;
        vNormal = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying vec3 vPosition;
      varying vec3 vNormal;
      void main() {
        vec2 p = vPosition.xy;
        float rippleA = sin(p.x * 0.11 + uTime * 0.7) * cos(p.y * 0.09 - uTime * 0.5);
        float rippleB = sin(p.x * 0.27 - p.y * 0.16 + uTime * 0.95);
        vec3 n = normalize(vNormal + vec3(rippleA * 0.19, rippleB * 0.12, 0.0));
        vec3 viewDirection = normalize(vec3(0.2, -0.7, 0.65));
        float fresnel = pow(1.0 - abs(dot(n, viewDirection)), 3.0);
        float light = max(dot(n, normalize(vec3(-0.4, 0.2, 1.0))), 0.0);
        vec3 muddyWater = vec3(0.19, 0.32, 0.34);
        vec3 silt = vec3(0.36, 0.35, 0.26);
        vec3 reflection = vec3(0.59, 0.73, 0.72);
        vec3 color = mix(muddyWater, silt, 0.2 + rippleA * 0.09);
        color = mix(color, reflection, fresnel * 0.7);
        color += light * 0.06 + rippleB * 0.015;
        float glint = pow(max(dot(reflect(-normalize(vec3(-0.4, 0.2, 1.0)), n), viewDirection), 0.0), 30.0);
        color += vec3(0.4, 0.5, 0.47) * glint * 0.3;
        gl_FragColor = vec4(color, uOpacity + fresnel * 0.12);
      }
    `,
  });
  const geometries: THREE.BufferGeometry[] = [];
  const point = (coordinate: number[]) => {
    const mercator = MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]]);
    return new THREE.Vector2((mercator.x - origin.x) / meter, -(mercator.y - origin.y) / meter);
  };
  for (const feature of data.features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const rings of polygons) {
      const shape = new THREE.Shape(rings[0].map(point));
      for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(point)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: Number(feature.properties?.h_vis ?? 1) * config.waterExaggeration, bevelEnabled: false, steps: 1, curveSegments: 1 });
      geometries.push(geometry);
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
  const layer: CustomLayerInterface & { rise: (progress: number) => void; enabled: boolean } = {
    id: 'water-shader', type: 'custom', renderingMode: '3d', enabled: false,
    rise(progress) { uniforms.uRise.value = progress; },
    onAdd(instance, gl) {
      map = instance;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
      if (!layer.enabled || uniforms.uRise.value <= 0) return;
      uniforms.uTime.value = performance.now() / 1000;
      camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(transform);
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
      map.triggerRepaint();
    },
    onRemove() { merged.dispose(); material.dispose(); renderer?.dispose(); },
  };
  return layer;
}
