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

  const deformMeshes = [];

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
        // 把反照率贴图当作自发光，雕塑会像从内部透光，斑点也会亮起来
        m.emissive = new THREE.Color(0xffffff);
        if (m.map) m.emissiveMap = m.map;
        m.emissiveIntensity = 0.28;
        m.toneMapped = true;
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
      m.roughness = Math.min(m.roughness ?? 1, 0.45);   // 雕塑表面偏亮面，玻璃感
      m.metalness = Math.max(m.metalness ?? 0, 0.05);
      deformMeshes.push(o);
    }
    if (o.morphTargetDictionary && 'bloom' in o.morphTargetDictionary) bell = o;
  });

  // ---- 顶点形变：伞盖收缩 + 触手拖尾摆动（静态网格的"活起来"方案）
  const boundsBox = new THREE.Box3().setFromObject(model);
  const yTop = boundsBox.max.y;
  const yBottom = boundsBox.min.y;
  const shaders = [];

  const patch = (mat) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uContract = { value: 0 };
      shader.uniforms.uSway = { value: 0.6 };
      shader.uniforms.uGlow = { value: 0.9 };
      shader.uniforms.uFlow = { value: 0.5 };
      shader.uniforms.uRim = { value: new THREE.Color('#7fd8ff') };
      shader.uniforms.uBottom = { value: yBottom };
      shader.uniforms.uTop = { value: yTop };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uContract, uSway, uBottom, uTop, uFlow;

          // 廉价的三维"水流"场：三个不同频率的正弦叠加，够有机、手机上也不贵
          vec3 flowField(vec3 p, float t) {
            float a = sin(p.x * 2.1 + t * 0.9) * cos(p.z * 1.7 - t * 0.7);
            float b = sin(p.y * 1.4 - t * 0.6 + p.z * 2.3);
            float c = cos(p.y * 3.1 + t * 1.3) * sin(p.x * 2.8 - t * 0.8);
            return vec3(a + 0.5 * c, 0.55 * b, b + 0.5 * c);
          }
        `)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float h = clamp((transformed.y - uBottom) / max(uTop - uBottom, 0.001), 0.0, 1.0);
            float bell = smoothstep(0.62, 0.92, h);          // 伞盖为正，触手区为 0
            float tail = 1.0 - bell;

            // 伞盖收缩：横向收、纵向拉伸，边缘收得更多
            float rim = smoothstep(0.58, 0.78, h) * (1.0 - smoothstep(0.9, 1.0, h));
            transformed.xz *= 1.0 - uContract * (0.10 * bell + 0.06 * rim);
            transformed.y += uContract * 0.06 * bell;

            // 触手：沿高度相位递延的拖尾摆动
            float w1 = sin(uTime * 1.5 - h * 7.0);
            float w2 = cos(uTime * 1.15 - h * 5.0 + 1.7);
            transformed.x += w1 * tail * 0.11 * uSway;
            transformed.z += w2 * tail * 0.09 * uSway;
            transformed.y += sin(uTime * 0.9 - h * 3.0) * tail * 0.03 * uSway;

            // 二次摆动：水流扰动，触手权重更大，越靠近梢部越明显
            vec3 flow = flowField(transformed * 1.35 + vec3(0.0, uTime * 0.15, 0.0), uTime);
            transformed += flow * (0.010 + tail * 0.075) * uFlow;

            // 整体洋流：更低频、幅度更小，让水母像被水推着晃
            vec3 drift = flowField(transformed * 0.35 + 17.0, uTime * 0.45);
            transformed += drift * 0.035 * uFlow;

            // 轻微扭转：伞盖边缘转一点，避免像硬塑料
            float twist = sin(transformed.y * 2.2 + uTime * 0.8) * 0.06 * uFlow * (0.3 + tail);
            float ct = cos(twist), stt = sin(twist);
            transformed.xz = mat2(ct, -stt, stt, ct) * transformed.xz;
          }
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uRim;
          uniform float uGlow, uTime;
        `)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
          vec3 rimCol = mix(uRim, vec3(1.0, 0.72, 0.86), 0.35 + 0.35 * sin(uTime * 0.35));
          totalEmissiveRadiance += rimCol * fres * uGlow;
        `);

      mat.userData.shader = shader;
      shaders.push(shader);
    };
    mat.needsUpdate = true;
  };

  for (const m of materials) patch(m);

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

    // 形变：收缩节律（快速收、缓慢放，像真水母）
    const period = 2.6 - state.energy * 0.9;
    const k = (state.time % period) / period;
    const quick = k < 0.32 ? Math.sin((k / 0.32) * Math.PI * 0.5) : Math.cos(((k - 0.32) / 0.68) * Math.PI * 0.5);
    const contract = THREE.MathUtils.clamp(quick * (0.55 + state.energy * 0.8) + morph.contract * 0.6, 0, 1.6);

    for (const sh of shaders) {
      sh.uniforms.uTime.value = state.time;
      sh.uniforms.uContract.value = contract;
      sh.uniforms.uSway.value = 0.5 + state.energy * 0.7 + state.bloom * 0.5;
      sh.uniforms.uFlow.value = 0.55 + state.energy * 0.5 + state.bloom * 0.8;
      sh.uniforms.uGlow.value = 0.34 + state.bloom * 0.7 + contract * 0.18;
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
