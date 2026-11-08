/**
 * gesture.js — 从 21 个关键点判断手势（纯函数，方便单测）
 *
 * 判定思路：
 *   手指伸直 = 指尖离腕关节的距离明显大于第二指节；
 *   0~1 根伸直 → 握拳，4~5 根 → 张开，其余 → 中性
 */

const FINGERS = [
  [8, 6],    // 食指 tip, pip
  [12, 10],  // 中指
  [16, 14],  // 无名指
  [20, 18]   // 小指
];

const PALM_IDS = [0, 5, 9, 13, 17];

export function palmCenter(lm) {
  let x = 0, y = 0;
  for (const i of PALM_IDS) { x += lm[i].x; y += lm[i].y; }
  return { x: x / PALM_IDS.length, y: y / PALM_IDS.length };
}

export function countExtended(lm) {
  const wrist = lm[0];
  let extended = 0;
  for (const [tip, pip] of FINGERS) {
    const dTip = Math.hypot(lm[tip].x - wrist.x, lm[tip].y - wrist.y);
    const dPip = Math.hypot(lm[pip].x - wrist.x, lm[pip].y - wrist.y);
    if (dTip > dPip * 1.12) extended++;
  }

  // 拇指：指尖离掌心明显更远才算张开
  const c = palmCenter(lm);
  const thumbSpread = Math.hypot(lm[4].x - c.x, lm[4].y - c.y) >
                      Math.hypot(lm[2].x - c.x, lm[2].y - c.y) * 1.25;
  if (thumbSpread && extended >= 3) extended++;

  return extended;
}

export function classify(lm) {
  const extended = countExtended(lm);
  const gesture = extended <= 1 ? 'fist' : extended >= 4 ? 'open' : 'neutral';
  return { gesture, extended };
}

/** 归一化到 [-1, 1]，并镜像 x（前置摄像头：屏幕上左边是手的右边） */
export function normalize(lm) {
  const c = palmCenter(lm);
  return {
    x: Math.max(-1, Math.min(1, (0.5 - c.x) * 2)),
    y: Math.max(-1, Math.min(1, (c.y - 0.5) * 2))
  };
}
