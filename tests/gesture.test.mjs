/**
 * 手势判定单测：用合成关键点验证 fist / open / neutral
 * 运行：node tests/gesture.test.mjs
 */
import assert from 'node:assert/strict';
import { classify, countExtended, normalize, palmCenter } from '../js/gesture.js';

const FINGER_BASE = [5, 9, 13, 17];

/** 生成 21 点：wrist 在下方，手指向上（y 越小越靠上） */
function makeHand(extendedCount) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.85, z: 0 }));
  lm[0] = { x: 0.5, y: 0.92, z: 0 };
  // 拇指
  lm[1] = { x: 0.38, y: 0.86, z: 0 };
  lm[2] = { x: 0.32, y: 0.80, z: 0 };
  lm[3] = { x: 0.28, y: 0.74, z: 0 };
  lm[4] = { x: 0.24, y: 0.68, z: 0 };

  FINGER_BASE.forEach((base, f) => {
    const x = 0.42 + f * 0.07;
    const ex = f < extendedCount;
    lm[base] = { x, y: 0.66, z: 0 };
    lm[base + 1] = { x, y: ex ? 0.5 : 0.62, z: 0 };   // pip
    lm[base + 2] = { x, y: ex ? 0.32 : 0.66, z: 0 };   // dip
    lm[base + 3] = { x, y: ex ? 0.18 : 0.68, z: 0 };   // tip
  });
  return lm;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('张开手掌 → open', () => {
  const r = classify(makeHand(4));
  assert.equal(r.gesture, 'open', `expect open, got ${r.gesture}`);
  assert.ok(r.extended >= 4);
});

test('握拳 → fist', () => {
  const r = classify(makeHand(0));
  assert.equal(r.gesture, 'fist', `expect fist, got ${r.gesture}`);
});

test('两指伸出 → neutral', () => {
  const r = classify(makeHand(2));
  assert.equal(r.gesture, 'neutral', `expect neutral, got ${r.gesture}`);
});

test('straightCount 单调', () => {
  for (let n = 0; n <= 4; n++) {
    assert.ok(countExtended(makeHand(n)) >= n, `n=${n}`);
  }
});

test('palmCenter 在掌心附近', () => {
  const c = palmCenter(makeHand(4));
  assert.ok(c.x > 0.4 && c.x < 0.65, `cx=${c.x}`);
  assert.ok(c.y > 0.6 && c.y < 0.8, `cy=${c.y}`);
});

test('normalize 镜像 + 夹紧到 [-1,1]', () => {
  const left = makeHand(4).map((p) => ({ ...p, x: p.x - 0.2 }));  // 手在画面左侧
  const n = normalize(left);
  assert.ok(n.x > 0, `屏幕左侧的手 x 应为正（镜像），got ${n.x}`);
  assert.ok(n.x <= 1 && n.x >= -1);
  assert.ok(n.y <= 1 && n.y >= -1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    failed++;
    console.log('FAIL', name, '-', err.message);
  }
}
console.log(failed ? `\n${failed} 项失败` : `\n全部通过（${tests.length} 项）`);
process.exit(failed ? 1 : 0);
