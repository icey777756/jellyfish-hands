/**
 * main.js — 水母手势交互页
 *
 * 输入优先级：URL 强制手势 > 摄像头手势 > 指针/触屏 > 自动演示
 * 手势 → 能量：握拳 0（收缩）· 张开 1（绽放）· 其余 0.45（常态漂浮）
 */

import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { createJellyfishFromGLB } from './jellyfish-glb.js';
import { HandTracker } from './hand.js';

const qs = new URLSearchParams(location.search);
const FORCED_GESTURE = qs.get('gesture');           // fist | open | neutral
const AUTO_DEMO = qs.get('auto') === '1';
const SKIP_INTRO = qs.get('skip') === '1';
const NO_BLOOM = qs.get('nobloom') === '1';
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ 场景 */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance'
});
// 低端机保守一点：Bloom + 高 DPR 是手机端最贵的两项
const LOW_END = (navigator.hardwareConcurrency || 8) <= 4;
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW_END ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#04050a');
scene.fog = new THREE.FogExp2('#04050a', 0.05);

const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0.1, 7.0);

/* 背景氛围：一大片径向渐变，制造深海感 */
const bgGeo = new THREE.PlaneGeometry(60, 60);
const bgMat = new THREE.ShaderMaterial({
  uniforms: {
    uTop: { value: new THREE.Color('#2a1745') },
    uBottom: { value: new THREE.Color('#04121a') },
    uTime: { value: 0 }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop; uniform vec3 uBottom; uniform float uTime;
    varying vec2 vUv;
    void main() {
      float d = distance(vUv, vec2(0.5, 0.55));
      vec3 col = mix(uTop, uBottom, smoothstep(0.0, 0.85, d));
      col += uBottom * 0.4;
      float glow = smoothstep(0.6, 0.0, d) * 0.35;
      col += vec3(0.12, 0.24, 0.32) * glow;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  depthWrite: false
});
const bg = new THREE.Mesh(bgGeo, bgMat);
bg.position.z = -12;
scene.add(bg);

/* 灯光：整体很暗，靠自发光与 bloom 出效果 */
scene.add(new THREE.AmbientLight(0x223044, 1.1));
const key = new THREE.DirectionalLight(0xffd9e2, 1.1);
key.position.set(2, 3, 4);
scene.add(key);
const rim = new THREE.DirectionalLight(0x7fd8ff, 0.9);
rim.position.set(-3, -1, -4);
scene.add(rim);

// 模型来自 Blender：assets/jellyfish.glb（骨骼动画 + 钟体形态键）
let jelly = null;
createJellyfishFromGLB('./assets/jellyfish.glb')
  .then((j) => {
    jelly = j;
    jelly.setPixelRatio(renderer.getPixelRatio());
    scene.add(jelly.group);
  })
  .catch((err) => {
    console.error('[jelly] GLB 载入失败', err);
    document.title = 'LOADFAIL: ' + (err && err.message);
    toast('水母模型载入失败，请检查 assets/jellyfish.glb');
  });

/* ------------------------------------------------------------------ 后期 */
let composer = null;
let bloomPass = null;
if (!NO_BLOOM) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.55, 0.5);
  composer.addPass(bloomPass);
}

/* ------------------------------------------------------------------ 输入 */
const input = {
  energy: 0.45, energyTarget: 0.45,
  bloom: 0, bloomTarget: 0,
  steerX: 0, steerY: 0, steerTargetX: 0, steerTargetY: 0,
  zoom: 1, zoomTarget: 1
};

let gesture = 'neutral';
let handPresent = false;
let lastGesture = 'neutral';

function onHandState(s) {
  handPresent = s.present;
  if (!s.present) {
    gesture = 'neutral';
    setHud('未检测到手', 'idle');
    return;
  }
  gesture = s.gesture;
  input.steerTargetX = s.x * 0.55;
  input.steerTargetY = s.y * 0.45;
  setHud(s.gesture === 'fist' ? '握拳 · 收缩' : s.gesture === 'open' ? '张开 · 绽放' : '漂浮',
         s.gesture === 'fist' ? 'fist' : s.gesture === 'open' ? 'open' : 'idle');
}

if (FORCED_GESTURE) {
  gesture = FORCED_GESTURE;
  setHud(gesture === 'fist' ? '握拳 · 收缩' : gesture === 'open' ? '张开 · 绽放' : '漂浮',
         gesture === 'fist' ? 'fist' : gesture === 'open' ? 'open' : 'idle');
}

/* 指针 / 触屏：没有摄像头时的降级控制 */
const pointers = new Map();
let pinchStartDist = 0;
let pinchStartZoom = 1;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
    pinchStartZoom = input.zoom;
  }
  if (!handPresent) {
    gesture = 'fist';
    setHud('握拳 · 收缩', 'fist');
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) {
    // 悬停也能引导方向（桌面端）
    if (!handPresent && !FORCED_GESTURE) {
      input.steerTargetX = (e.clientX / innerWidth - 0.5) * 1.1;
      input.steerTargetY = (e.clientY / innerHeight - 0.5) * 0.9;
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStartDist > 0) {
      input.zoomTarget = THREE.MathUtils.clamp(pinchStartZoom * (dist / pinchStartDist), 0.65, 2.2);
    }
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStartDist = 0;
  if (pointers.size === 0 && !handPresent && !FORCED_GESTURE) {
    gesture = 'neutral';
    setHud('漂浮', 'idle');
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  input.zoomTarget = THREE.MathUtils.clamp(input.zoomTarget * (1 - e.deltaY * 0.0012), 0.65, 2.2);
}, { passive: false });

/* 手动按钮（无摄像头时也能演示） */
document.querySelectorAll('[data-force]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const g = btn.dataset.force;
    gesture = gesture === g ? 'neutral' : g;
    setHud(gesture === 'fist' ? '握拳 · 收缩' : gesture === 'open' ? '张开 · 绽放' : '漂浮',
           gesture === 'fist' ? 'fist' : gesture === 'open' ? 'open' : 'idle');
  });
});

/* ------------------------------------------------------------------ HUD */
function setHud(text, kind) {
  const chip = $('#gesture');
  if (!chip) return;
  chip.textContent = text;
  chip.dataset.kind = kind;
}

/* 张开手掌的上升沿 → 一次绽放脉冲 */
function pulseBloom(strength = 0.75) {
  input.bloomTarget = Math.max(input.bloomTarget, strength);
}

/* ------------------------------------------------------------------ 摄像头 */
const video = $('#cam');
const overlay = $('#landmarks');

let activeTracker = null;

async function enableCamera() {
  $('#intro').classList.add('gone');
  const tracker = new HandTracker({ video, overlay, onState: onHandState, fps: 24 });
  activeTracker = tracker;
  try {
    await tracker.start();
    $('#camwrap').classList.add('live');
    setHud('把手放进画面', 'idle');
    window.__jelly.cameraStatus = 'running:' + tracker.delegate;
  } catch (err) {
    console.warn('[camera] 启动失败', err);
    $('#camwrap').classList.remove('live');
    setHud('摄像头不可用 · 用触摸控制', 'idle');
    toast('无法访问摄像头，已切换到触摸 / 按钮控制');
    window.__jelly.cameraStatus = 'error:' + (err && err.name ? err.name : String(err));
  }
  return tracker;
}

$('#btn-camera').addEventListener('click', enableCamera);
$('#btn-skip').addEventListener('click', () => {
  $('#intro').classList.add('gone');
  setHud('漂浮 · 触摸控制', 'idle');
});

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ------------------------------------------------------------------ 循环 */
const clock = new THREE.Clock();
let autoT = 0;

function resolveGesture(dt) {
  if (FORCED_GESTURE) return FORCED_GESTURE;
  if (AUTO_DEMO) {
    autoT += dt;
    const phase = Math.floor(autoT / 2.4) % 3;
    return ['fist', 'open', 'neutral'][phase];
  }
  return gesture;
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  const g = resolveGesture(dt);
  input.energyTarget = g === 'fist' ? 0.04 : g === 'open' ? 0.98 : 0.45;

  // 张开：持续轻微外扩 + 上升沿脉冲
  if (g === 'open') {
    input.bloomTarget = Math.max(input.bloomTarget * 0.96, 0.45);
  } else if (g === 'fist') {
    input.bloomTarget *= 0.90;
  } else {
    input.bloomTarget *= 0.94;
  }
  if (g === 'open' && lastGesture !== 'open') pulseBloom(1.0);
  if (g === 'fist' && lastGesture !== 'fist') pulseBloom(0.35);
  lastGesture = g;

  const ease = (cur, tgt, k) => cur + (tgt - cur) * Math.min(1, dt * k);
  input.energy = ease(input.energy, input.energyTarget, 4.5);
  input.bloom = ease(input.bloom, input.bloomTarget, 3.2);
  input.steerX = ease(input.steerX, input.steerTargetX, 2.6);
  input.steerY = ease(input.steerY, input.steerTargetY, 2.6);
  input.zoom = ease(input.zoom, input.zoomTarget, 6);

  camera.position.z = 7.0 / input.zoom;
  camera.lookAt(0, -1.0, 0);

  if (jelly) {
    jelly.update(dt, {
      energy: input.energy,
      bloom: input.bloom,
      steer: { x: input.steerX, y: input.steerY }
    });
  }
  bgMat.uniforms.uTime.value += dt;

  if (bloomPass) bloomPass.strength = 0.34 + input.bloom * 0.40;
  if (composer) composer.render(dt); else renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ 尺寸 */
function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h;
  camera.fov = w / h < 0.75 ? 58 : 46;      // 竖屏手机拉大视野
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (overlay) { overlay.width = 320; overlay.height = 240; }
}

addEventListener('resize', () => {
  resize();
  if (jelly) jelly.setPixelRatio(renderer.getPixelRatio());
});
resize();

tick();

/* 调试与自动化：暴露状态，方便截图/联调 */
window.__jelly = {
  input, get jelly() { return jelly; },
  setGesture(g) { gesture = g; },
  renderer,
  get hand() { return { present: handPresent, gesture, energy: input.energy }; },
  get tracker() { return activeTracker; }
};

// ?sim=1：合成手部关键点，走与真实识别完全相同的链路（无摄像头联调）
if (qs.get('sim') === '1') {
  Promise.all([import('./gesture.js'), import('./sim.js')]).then(([{ classify, normalize }, { makeHand }]) => {
    let step = 0;
    setInterval(() => {
      const counts = [0, 4, 2, 4];
      const n = counts[step % counts.length];
      const lm = makeHand(n, Math.sin(step * 0.9) * 0.12);
      const { gesture: g } = classify(lm);
      const pos = normalize(lm);
      onHandState({ present: true, gesture: g, x: pos.x, y: pos.y });
      step++;
    }, 1600);
  });
}

// ?selftest=1：只验证 MediaPipe 模型能否加载并跑一次推理（不碰摄像头）
if (qs.get('selftest') === '1') {
  (async () => {
    try {
      const t = new HandTracker({ video, overlay });
      const delegate = await t.initModel();
      const c = document.createElement('canvas');
      c.width = 320; c.height = 240;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 320, 240);
      const res = t.landmarker.detectForVideo(c, performance.now());
      window.__selftest = { ok: true, delegate, hands: (res?.landmarks || []).length };
    } catch (err) {
      window.__selftest = { ok: false, error: String((err && err.message) || err) };
    }
  })();
}

// ?camera=1：自动开启摄像头（联调 / 自动化测试用）
if (qs.get('camera') === '1') {
  enableCamera().catch(() => {});
}

if (SKIP_INTRO) {
  $('#intro').classList.add('gone');
  if (!FORCED_GESTURE) setHud('漂浮 · 触摸控制', 'idle');
}

if (prefersReduced) {
  document.documentElement.classList.add('reduce-motion');
}
