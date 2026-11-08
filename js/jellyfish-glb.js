/**
 * jellyfish-glb.js — 加载 Blender 导出的水母（assets/jellyfish.glb）
 *
 * Blender 侧提供：
 *   · 骨骼动画（9 条触手 × 6 节，循环游动）→ AnimationMixer
 *   · 钟体形态键 bloom / contract          → morphTargetInfluences
 * 网页侧负责：材质透明化、线框叠加、粒子、手势映射。
 */

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/three/addons/loaders/DRACOLoader.js';

const PARTICLE_COLOR = new THREE.Color('#bfe4ff');

function makeParticles(count = 650) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = 1.8 + Math.random() * 5.5;
    const theta = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(theta) * r;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 7;
    positions[i * 3 + 2] = Math.sin(theta) * r - 1.5;
    seeds[i] = Math.random() * Math.PI * 2;
    sizes[i] = 0.6 + Math.random() * 1.8;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 }, uBloom: { value: 0 }, uBurst: { value: 0 },
    uColor: { value: PARTICLE_COLOR }, uPixelRatio: { value: 1 }
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime, uBloom, uBurst, uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.5 + aSeed) * 0.35;
        p.y += cos(uTime * 0.42 + aSeed * 1.7) * 0.35;
        p.z += sin(uTime * 0.37 + aSeed * 2.1) * 0.3;
        p += normalize(p) * uBurst * (1.2 + aSeed);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * uPixelRatio * (7.0 / -mv.z) * (1.0 + uBloom * 0.5);
        vAlpha = (0.25 + 0.35 * (0.5 + 0.5 * sin(uTime + aSeed))) * (1.0 + uBloom * 0.6);
        vAlpha *= smoothstep(0.0, 1.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        gl_FragColor = vec4(uColor, smoothstep(0.5, 0.0, d) * vAlpha);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });

  return { points: new THREE.Points(geo, mat), uniforms };
}

export async function createJellyfishFromGLB(url = './assets/jellyfish.glb') {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('./vendor/three/libs/draco/gltf/');
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync(url);
  const group = new THREE.Group();
  const model = gltf.scene;

  // 统一尺寸与位置：不管模型原始单位多大，都规整到画面中央
  const preBox = new THREE.Box3().setFromObject(model);
  const preSize = preBox.getSize(new THREE.Vector3());
  const targetHeight = 3.55;
  model.scale.multiplyScalar(targetHeight / (preSize.y || 1));
  model.updateMatrixWorld(true);

  // 缩放后重新量一次包围盒，居中到镜头注视点 (0, -1, 0)
  const box2 = new THREE.Box3().setFromObject(model);
  const c2 = box2.getCenter(new THREE.Vector3());
  model.position.x -= c2.x;
  model.position.y -= c2.y;
  model.position.z -= c2.z;
  model.position.y -= 1.0;

  model.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(model);
  const fs = finalBox.getSize(new THREE.Vector3());
  const fc = finalBox.getCenter(new THREE.Vector3());
  window.__jellyBox = {
    size: [+fs.x.toFixed(2), +fs.y.toFixed(2), +fs.z.toFixed(2)],
    center: [+fc.x.toFixed(2), +fc.y.toFixed(2), +fc.z.toFixed(2)],
    cam: (() => {
      const c = window.__stage && window.__stage.camera;
      return c ? [+c.position.x.toFixed(2), +c.position.y.toFixed(2), +c.position.z.toFixed(2)] : null;
    })()
  };

  const baseScale = model.scale.x;   // update() 里在此基础上做呼吸

  group.add(model);

  let bell = null;
  const materials = [];

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      m.transparent = true;
      m.depthWrite = false;
      m.side = THREE.DoubleSide;
      m.envMapIntensity = 1.4;
      if (m.emissive) {
        // 扫描件没有自发光贴图，补一点点，让 Bloom 能吃到高光
        m.emissiveIntensity = 0.08;
        m.emissive = new THREE.Color('#1e3f7a');
      }

      // 金色斑点：必须排在半透明钟体之后渲染，否则会被蓝色罩住变成灰白
      if (/dots/.test(o.name || '')) {
        m.transparent = true;
        m.depthWrite = true;
        o.renderOrder = 9;
        m.emissiveIntensity = 1.8;
      }
      m.needsUpdate = true;
      materials.push(m);
    }
    if (o.morphTargetDictionary && 'bloom' in o.morphTargetDictionary) bell = o;
  });

  const particles = makeParticles();
  group.add(particles.points);

  const mixer = new THREE.AnimationMixer(model);
  const clip = gltf.animations && gltf.animations[0];
  if (clip) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }

  const state = { energy: 0.45, bloom: 0, time: 0 };
  const morph = { bloom: 0, contract: 0 };
  const target = new THREE.Vector3();

  function update(dt, input) {
    state.time += dt;
    state.energy += (input.energy - state.energy) * Math.min(1, dt * 5);
    state.bloom += (input.bloom - state.bloom) * Math.min(1, dt * 4);

    // 握拳 → 律动加快但幅度小；张开 → 慢而大
    const speed = 0.7 + state.energy * 1.8;
    if (clip) mixer.update(dt * speed);

    // 形态键：张开时往外展，握拳时收拢
    const targetBloom = THREE.MathUtils.clamp(state.bloom, 0, 1);
    const targetContract = THREE.MathUtils.clamp(1 - state.energy, 0, 1) * 0.85;
    morph.bloom += (targetBloom - morph.bloom) * Math.min(1, dt * 4);
    morph.contract += (targetContract - morph.contract) * Math.min(1, dt * 4);

    if (bell) {
      const d = bell.morphTargetDictionary;
      bell.morphTargetInfluences[d.bloom] = morph.bloom;
      bell.morphTargetInfluences[d.contract] = morph.contract;
    }

    // 自发光随绽放增强
    const glow = 1.2 + state.bloom * 1.6;
    for (const m of materials) {
      if (m.emissive && 'emissiveIntensity' in m) m.emissiveIntensity = glow;
    }

    particles.uniforms.uTime.value = state.time;
    particles.uniforms.uBloom.value = state.bloom;
    particles.uniforms.uBurst.value = state.bloom * 0.55;

    // 游动：朝手指方向漂移 + 轻微转向
    const steer = input.steer || { x: 0, y: 0 };
    target.set(steer.x * 1.1, -steer.y * 0.7 + Math.sin(state.time * 0.8) * 0.1, 0);
    group.position.lerp(target, Math.min(1, dt * 2));

    const breath = Math.sin(state.time * (0.9 + state.energy * 1.4));
    group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, -steer.x * 0.18 + breath * 0.02, dt * 3);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, steer.y * 0.16, dt * 3);
    group.rotation.y += dt * (0.08 + state.energy * 0.06);

    const breathe = 1 + morph.bloom * 0.10 - morph.contract * 0.08
      + Math.sin(state.time * 0.9) * 0.012;
    model.scale.setScalar(baseScale * breathe);
  }

  return {
    group, update, state, mixer, clip,
    setPixelRatio(v) { particles.uniforms.uPixelRatio.value = v; },
    get morph() { return morph; }
  };
}
