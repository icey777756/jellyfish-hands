/**
 * sim.js — 合成手部关键点，用于无摄像头环境下的联调与演示
 * 与真实 MediaPipe 输出同构：21 个点，x/y 归一化到 [0,1]
 */

const FINGER_BASE = [5, 9, 13, 17];

export function makeHand(extendedCount, offsetX = 0) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5 + offsetX, y: 0.85, z: 0 }));
  lm[0] = { x: 0.5 + offsetX, y: 0.92, z: 0 };
  lm[1] = { x: 0.38 + offsetX, y: 0.86, z: 0 };
  lm[2] = { x: 0.32 + offsetX, y: 0.80, z: 0 };
  lm[3] = { x: 0.28 + offsetX, y: 0.74, z: 0 };
  lm[4] = { x: 0.24 + offsetX, y: 0.68, z: 0 };

  FINGER_BASE.forEach((base, f) => {
    const x = 0.42 + f * 0.07 + offsetX;
    const ex = f < extendedCount;
    lm[base] = { x, y: 0.66, z: 0 };
    lm[base + 1] = { x, y: ex ? 0.5 : 0.62, z: 0 };
    lm[base + 2] = { x, y: ex ? 0.32 : 0.66, z: 0 };
    lm[base + 3] = { x, y: ex ? 0.18 : 0.68, z: 0 };
  });
  return lm;
}
