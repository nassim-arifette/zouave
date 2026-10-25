import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export interface HeroOptions { photoUrl: string; depthUrl: string; fov: number; pitch: number; cameraHeight: number; target: number; onLevel?: (level: number) => void }

const GRID_W = 400;
const MAX_LEVEL = 3;

const noiseGlsl = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }`;

async function loadDepth(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, image.width, image.height).data;
  const metres = new Float32Array(image.width * image.height);
  for (let i = 0; i < metres.length; i++) metres[i] = (rgba[i * 4] * 256 + rgba[i * 4 + 1]) / 100;
  return { data: metres, width: image.width, height: image.height };
}

function roadColour(image: HTMLImageElement) {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, image.height * 0.94, image.width, image.height * 0.06, 0, 0, 32, 4);
  const rgba = ctx.getImageData(0, 0, 32, 4).data;
  const sum = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) { sum[0] += rgba[i]; sum[1] += rgba[i + 1]; sum[2] += rgba[i + 2]; }
  const n = rgba.length / 4;
  return new THREE.Color(sum[0] / n / 255, sum[1] / n / 255, sum[2] / n / 255).convertSRGBToLinear().multiplyScalar(0.85);
}

export function createHero(container: HTMLElement) {
  let renderer: THREE.WebGLRenderer | undefined;
  let frame = 0;
  let dispose = () => {};
  const state = { level: 0, target: 0, start: 0, from: 0 };
  const stop = () => { cancelAnimationFrame(frame); dispose(); dispose = () => {}; };
  const setLevel = (level: number) => { state.level = Math.max(0, Math.min(MAX_LEVEL, level)); state.target = state.level; };

  async function show(options: HeroOptions) {
    stop();
    renderer ??= new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    container.replaceChildren(renderer.domElement);
    const [texture, depth] = await Promise.all([new THREE.TextureLoader().loadAsync(options.photoUrl), loadDepth(options.depthUrl)]);
    texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
    const aspect = depth.width / depth.height;
    const tanX = Math.tan(THREE.MathUtils.degToRad(options.fov / 2)), tanY = tanX / aspect;
    const vfov = THREE.MathUtils.radToDeg(2 * Math.atan(tanY));
    const camera = new THREE.PerspectiveCamera(vfov, aspect, 0.1, 600);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9aa3ad);
    const tilt = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(options.pitch));
    const uniforms = { uWater: { value: -50 } };

    // Relief: unproject every depth sample along its camera ray, lift by the camera height, drop stretched triangles at depth jumps.
    const gridH = Math.round(GRID_W / aspect);
    const count = (GRID_W + 1) * (gridH + 1);
    const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2), depths = new Float32Array(count);
    const v = new THREE.Vector3();
    for (let j = 0; j <= gridH; j++) for (let i = 0; i <= GRID_W; i++) {
      const k = j * (GRID_W + 1) + i, u = i / GRID_W, t = j / gridH;
      const px = Math.min(depth.width - 1, Math.round(u * (depth.width - 1))), py = Math.min(depth.height - 1, Math.round(t * (depth.height - 1)));
      const d = depth.data[py * depth.width + px];
      v.set((u * 2 - 1) * tanX * d, (1 - t * 2) * tanY * d, -d).applyMatrix4(tilt);
      positions.set([v.x, v.y + options.cameraHeight, v.z], k * 3); uvs.set([u, 1 - t], k * 2); depths[k] = d;
    }
    const index: number[] = [];
    for (let j = 0; j < gridH; j++) for (let i = 0; i < GRID_W; i++) {
      const a = j * (GRID_W + 1) + i, b = a + 1, c = a + GRID_W + 1, e = c + 1;
      const near = Math.min(depths[a], depths[b], depths[c], depths[e]), far = Math.max(depths[a], depths[b], depths[c], depths[e]);
      if (far / near > 1.12 + 0.002 * near) continue;
      index.push(a, c, b, b, c, e);
    }
    const relief = new THREE.BufferGeometry();
    relief.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    relief.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    relief.setIndex(index);
    const photoMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, ...uniforms }, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map; uniform float uWater; varying vec2 vUv; varying vec3 vWorld;
        void main() {
          vec3 c = texture2D(map, vUv).rgb;
          float wet = smoothstep(uWater + 0.35, uWater, vWorld.y); c *= mix(1.0, 0.55, wet);
          float line = exp(-abs(vWorld.y - uWater - 0.03) * 40.0); c = mix(c, vec3(0.25, 0.21, 0.15), line * 0.5);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    scene.add(new THREE.Mesh(relief, photoMaterial));
    // Backdrop anchored in the world so holes at depth edges show the photo itself, even when the camera lifts.
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2 * tanX * 300, 2 * tanY * 300), new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);\n#include <colorspace_fragment>\n}`,
    }));
    backdrop.position.set(0, 0, -300).applyMatrix4(tilt); backdrop.position.y += options.cameraHeight; backdrop.quaternion.setFromRotationMatrix(tilt);
    scene.add(backdrop);
    // Street level under the relief so the water has a consistent bed right up to the camera.
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: roadColour(texture.image as HTMLImageElement) }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -0.02; bed.renderOrder = -1;
    scene.add(bed);

    // Water: planar reflection (Reflector) + screen-space refraction of a colour/depth prepass, Beer–Lambert silt, foam at walls.
    const prepass = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
    const water = new Reflector(new THREE.PlaneGeometry(800, 800), {
      textureWidth: 1024, textureHeight: 1024, clipBias: 0.01, multisample: 0,
      shader: {
        name: 'FloodWater',
        uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, tScene: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uNear: { value: camera.near }, uFar: { value: camera.far }, uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
        vertexShader: `uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vWorld; varying float vViewZ;
          void main() { vUvR = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mv = viewMatrix * w; vViewZ = mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `#include <packing>
          uniform sampler2D tDiffuse, tScene, tDepth; uniform vec2 uRes; uniform float uNear, uFar, uTime; uniform vec3 uCam;
          varying vec4 vUvR; varying vec3 vWorld; varying float vViewZ;
          ${noiseGlsl}
          float height(vec2 p) { vec2 flow = vec2(0.35, -0.9) * uTime;
            return noise(p * 1.3 + flow) * 0.5 + noise(p * 3.1 - flow * 1.4 + 7.0) * 0.25 + noise(p * 7.7 + vec2(uTime * 0.8, -uTime * 1.7)) * 0.12 + noise(p * 17.0 + uTime * 2.3) * 0.05; }
          float sceneZ(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
          void main() {
            vec2 p = vWorld.xz; float e = 0.04; float dist = length(uCam - vWorld);
            vec2 g = vec2(height(p + vec2(e, 0)) - height(p - vec2(e, 0)), height(p + vec2(0, e)) - height(p - vec2(0, e))) / (2.0 * e);
            float fade = 1.0 / (1.0 + dist * 0.04) * mix(0.35, 1.0, smoothstep(0.8, 4.0, dist));
            vec3 n = normalize(vec3(-g.x * 0.35 * fade, 1.0, -g.y * 0.35 * fade));
            vec3 V = normalize(uCam - vWorld);
            float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            vec2 suv = gl_FragCoord.xy / uRes;
            float thick = max(vViewZ - sceneZ(suv), 0.0);
            vec2 ruv = suv + n.xz * 0.035 * clamp(thick, 0.0, 1.0);
            if (sceneZ(ruv) > vViewZ) ruv = suv;
            float thickR = max(vViewZ - sceneZ(ruv), 0.0);
            vec3 under = texture2D(tScene, ruv).rgb;
            vec3 murk = vec3(0.075, 0.068, 0.042);
            vec3 body = mix(murk, under * vec3(0.55, 0.5, 0.36), exp(-thickR * vec3(5.5, 6.5, 9.0)));
            vec4 rc = vUvR; rc.xy += n.xz * 0.06 * rc.w;
            vec3 refl = texture2DProj(tDiffuse, rc).rgb;
            vec3 col = mix(body, refl * 0.8, clamp(F * 1.1, 0.0, 0.9));
            float shore = 1.0 - smoothstep(0.0, 0.18, thick);
            float foamNoise = noise(p * 9.0 + uTime * vec2(0.3, -0.8)) * noise(p * 23.0 - uTime);
            col = mix(col, vec3(0.62, 0.58, 0.48), shore * smoothstep(0.15, 0.45, foamNoise) * 0.8);
            float debris = step(0.93, noise(p * 2.2 + vec2(0.35, -0.9) * uTime * 0.7)) * step(0.6, noise(p * 31.0));
            col = mix(col, vec3(0.42, 0.30, 0.14), debris * 0.6 * fade);
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      },
    });
    water.rotation.x = -Math.PI / 2;
    const waterUniforms = (water.material as THREE.ShaderMaterial).uniforms;
    waterUniforms.tScene.value = prepass.texture; waterUniforms.tDepth.value = prepass.depthTexture;
    scene.add(water);

    const resize = () => {
      const width = container.clientWidth, height = Math.round(width / aspect);
      renderer!.setSize(width, height, false);
      const size = renderer!.getDrawingBufferSize(new THREE.Vector2());
      prepass.setSize(size.x, size.y); waterUniforms.uRes.value.copy(size);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.level = 0; state.from = 0; state.target = options.target; state.start = performance.now();
    const duration = reduceMotion ? 0 : 3000 + options.target * 2400;
    let shownLevel = -1;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (state.level !== state.target) {
        const t = duration ? Math.min((now - state.start) / duration, 1) : 1;
        state.level = state.from + (state.target - state.from) * (1 - Math.pow(1 - t, 2));
      }
      if (Math.abs(state.level - shownLevel) > 0.004) { shownLevel = state.level; options.onLevel?.(state.level); }
      const time = now / 1000, level = state.level, wet = level > 0.005;
      const eye = Math.max(options.cameraHeight, level + 0.4);
      camera.position.set(Math.sin(time * 0.21) * 0.15, eye + Math.sin(time * 0.5) * 0.02, Math.sin(time * 0.13) * 0.2);
      camera.rotation.set(THREE.MathUtils.degToRad(options.pitch) - (eye - options.cameraHeight) * 0.1, Math.sin(time * 0.17) * 0.01, 0, 'YXZ');
      camera.updateMatrixWorld();
      water.position.y = wet ? level : -50; uniforms.uWater.value = wet ? level : -50;
      waterUniforms.uTime.value = time; waterUniforms.uCam.value.copy(camera.position);
      water.visible = false;
      if (wet) { renderer!.setRenderTarget(prepass); renderer!.render(scene, camera); renderer!.setRenderTarget(null); }
      water.visible = wet;
      renderer!.render(scene, camera);
    };
    frame = requestAnimationFrame(tick);
    dispose = () => {
      observer.disconnect();
      relief.dispose(); photoMaterial.dispose(); bed.geometry.dispose(); (bed.material as THREE.Material).dispose(); backdrop.geometry.dispose(); (backdrop.material as THREE.Material).dispose();
      water.dispose(); prepass.dispose(); texture.dispose();
    };
  }

  return {
    show, stop,
    setLevel,
    animateTo(level: number) { state.from = state.level; state.target = Math.max(0, Math.min(MAX_LEVEL, level)); state.start = performance.now(); },
    get level() { return state.level; },
  };
}
