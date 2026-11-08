/**
 * hand.js — MediaPipe HandLandmarker 封装
 *
 * 输出统一状态：{ present, gesture: 'fist' | 'open' | 'neutral', x, y }
 *   x/y 为镜像后的归一化坐标，范围 [-1, 1]（右手在画面右侧时 x 为正）
 *
 * 模型与 wasm 全部走本地 vendor/，不依赖 CDN（手机在地铁里也能跑）。
 */

import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { classify, normalize } from './gesture.js';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
];

const FINGERS = [
  [8, 6], [12, 10], [16, 14], [20, 18]
];

export class HandTracker {
  constructor({ video, overlay, onState, fps = 30 }) {
    this.video = video;
    this.overlay = overlay;
    this.onState = onState || (() => {});
    this.fps = fps;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.state = { present: false, gesture: 'neutral', x: 0, y: 0 };
    this.smooth = { x: 0, y: 0 };
    this._loop = this._loop.bind(this);
  }

  /** 只初始化模型（不碰摄像头），用于自检 / 无摄像头环境 */
  async initModel() {
    if (this.landmarker) return this.delegate;
    const vision = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: {
        modelAssetPath: './vendor/mediapipe/hand_landmarker.task',
        delegate
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.55
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, options('GPU'));
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('[hand] GPU 委托不可用，回落到 CPU', err);
      this.landmarker = await HandLandmarker.createFromOptions(vision, options('CPU'));
      this.delegate = 'CPU';
    }
    return this.delegate;
  }

  async start() {
    if (this.running) return this.state;

    // 摄像头：优先前置（照手），低分辨率就够
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    await this.initModel();

    this.running = true;
    requestAnimationFrame(this._loop);
    return this.state;
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.landmarker) this.landmarker.close();
    this.landmarker = null;
    this.stream = null;
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);

    // 按 fps 节流，避免手机上把手势推理打满
    if (now - (this._last || 0) < 1000 / this.fps) return;
    this._last = now;

    if (this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;   // 没有新帧就跳过
    this.lastVideoTime = this.video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(this.video, now);
    } catch (err) {
      console.warn('[hand] detect 失败', err);
      return;
    }

    const lm = result?.landmarks?.[0];
    if (!lm) {
      this.state = { ...this.state, present: false };
      this._draw(null);
      this.onState(this.state);
      return;
    }

    this.state = this._interpret(lm);
    this._draw(lm);
    this.onState(this.state);
  }

  _interpret(lm) {
    const { gesture } = classify(lm);
    const n = normalize(lm);

    this.smooth.x += (n.x - this.smooth.x) * 0.35;
    this.smooth.y += (n.y - this.smooth.y) * 0.35;

    return { present: true, gesture, x: this.smooth.x, y: this.smooth.y };
  }

  _draw(lm) {
    const c = this.overlay;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!lm) return;

    const w = c.width, h = c.height;
    const px = (p) => [(1 - p.x) * w, p.y * h];   // 镜像绘制

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150, 235, 220, 0.85)';
    ctx.beginPath();
    for (const [a, b] of CONNECTIONS) {
      const [ax, ay] = px(lm[a]), [bx, by] = px(lm[b]);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    for (const p of lm) {
      const [x, y] = px(p);
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
