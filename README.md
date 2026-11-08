# 水母 · 手势交互（移动端 3D 网页）

摄像头识别手势：**握拳 → 水母收拢，张开手掌 → 向外绽放**，手掌位置引导游动方向，双指捏合缩放。
参考画面：`model/refs/reference-blue.jpg`（蓝色玻璃水母）+ `reference.png`（紫金版）：紫金色发光水母——
紫罗兰色半透钟体、伞沿的暖金色发光带、钟体内部的金色脉络、以及大量金/蓝细丝与发光珠点。
模型在 **Blender** 里建模并做好骨骼游动动画，再导出 GLB 给网页加载。

当前美术方向是蓝色玻璃水母：紫蓝渐变、奶白与琥珀斑点、蕾丝边的褶皱口腕、成束的蓝色细丝。
技术栈：Three.js（GLB + Bloom + 粒子）· MediaPipe Hands（21 关键点）· 原生 JS/CSS · 零构建（ES Module + importmap）。

---

## 运行

```bash
cd sites/jellyfish-hands
./serve.sh                 # http://127.0.0.1:5180/
```

必须有摄像头就开 HTTPS 或 localhost；`localhost` 天然属于安全上下文，直接可用。

### 手机上测

手机通过局域网 IP 访问时，`http://192.168.x.x` **不是**安全上下文，浏览器会拒绝 `getUserMedia`。三个办法：

1. **隧道（推荐）**：`cloudflared tunnel --url http://127.0.0.1:5180` 或 `ngrok http 5180`，用 HTTPS 地址打开
2. **反向代理**：把 `serve.sh --lan` 的端口用带证书的 nginx / Caddy 反代
3. **临时放行**：手机 Chrome 打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，
   填入 `http://<你的IP>:5180` 并重启浏览器（仅调试用）

`./serve.sh --lan` 会打印局域网地址。

---

## 交互

| 操作 | 效果 |
| --- | --- |
| 握拳 | 钟体收拢、触手内收、整体变小、频率变快 |
| 手掌张开 | 钟体展平外扩、触手向外绽放、粒子爆发一次 |
| 移动手掌 | 水母朝该方向游动（带阻尼跟随） |
| 双指捏合 | 缩放视角（0.65× ~ 2.2×） |
| 底部按钮 | 无摄像头时的手动演示（握拳 / 张开 / 漂浮） |

摄像头不可用会自动降级为触摸控制，并提示一次，不会白屏。

---

## 结构

```
jellyfish-hands/
├── index.html          页面骨架 + importmap
├── styles.css          移动端布局、HUD、开场、安全区适配
├── model/               Blender 工程
│   ├── scene.py         建模脚本（--stage blockout / material）
│   └── dist/            白模与材质预览渲染
├── assets/
│   └── jellyfish.glb    导出的模型（含骨骼动画 + 钟体形态键）
├── js/
│   ├── main.js         场景、Bloom、输入融合、手势→能量映射、缩放
│   ├── jellyfish-glb.js 加载 GLB：动画播放、形态键、粒子、手势映射
│   ├── hand.js         MediaPipe HandLandmarker 封装（GPU→CPU 回落、骨架绘制）
│   ├── gesture.js      21 点 → 手势（纯函数，可单测）
│   └── sim.js          合成关键点，用于无摄像头联调
├── tests/
│   └── gesture.test.mjs 手势判定单测（node 跑）
└── vendor/             three.js + 后期 + MediaPipe（全部本地化，不依赖 CDN）
```

---

## Blender 建模

```bash
bl run model/scene.py -- --stage blockout    # 白模三机位，先看结构与比例
bl run model/scene.py -- --stage material    # 材质 + 导出 assets/jellyfish.glb
```

模型构成（全部脚本生成，可复现）：

| 部件 | 做法 |
| --- | --- |
| `bell` 钟体 | 8 瓣参数化伞盖（96×26），**顶点色**做蓝紫渐变 + 淡蓝自发光，alpha 0.38（更通透），带 bloom / contract 形态键 |
| `dots_gold` | 钟体上 144 颗金色小斑点，按 `acos` 反变换做球面**面积均匀**分布（正面同样铺满） |
| `rim` 光环 | 沿伞沿的环面，暖金色强自发光 |
| `veins` 脉络 | 14 条从钟顶辐射到伞沿的细带，位于钟体内部 |
| `fronds` 口腕 | 5 条宽褶皱薄膜，两侧镶发光"蕾丝边"，随骨骼摆动 |
| `filaments` 触须 | **14 条宽飘带**（宽 0.082 / 厚 0.012，沿长度收窄、边缘波浪、缓慢扭转），6 边形截面中间有折痕 |
| `collar` 过渡膜 | 从伞沿收进中心（r 1.0 → 0.14）、下坠 0.62 的裙边，把 14 条飘带根部连成一片；底边顶点 alpha 淡出 |
| 根部衔接 | 飘带根部收拢在伞盖正下方（r≈0.18）并伸进钟体内部，顶点 alpha 在头 14% 淡入，看不出截断 |
| 飘带质感 | 顶点色边缘提亮（1.15×）+ 中缝压暗（0.85×），配合扭转做出布带的明暗 |
| 触须渐隐 | 顶点色 alpha 沿长度按 `(1-t)^1.5` 衰减，梢部自然淡出（导出为 COLOR_0 的 vec4 alpha） |
| 触须发光 | 自发光强度 3.0 + 每 7 节加粗的节点，配合 Bloom 出"发光丝"效果 |

动画：每条链 **8 根骨骼**，108 帧一循环。**不用纯正弦**，改成弹簧跟随：
每个关键帧给每根骨骼一个目标角度，骨骼按刚度追过去，刚度沿链条递减（0.62 → 0.12），
所以根节跟得紧、梢节拖得久，形成水中的跟随拖尾。
再叠加主波 + 次级慢波与每条触须自己的相位/幅度系数（`1 + 0.35·sin(k·1.7)`），避免整齐划一。
口腕摆动幅度只有触须的 55%，避免整体像"水草"。

> 验证动画真的在跑：连续截两帧做像素 diff，差异集中在触须区域（12.7% 像素），说明是骨骼在动而不是静态网格。

> **顶点色要接线**：Blender 的 glTF 导出器只在材质真正使用顶点色时才写 COLOR_0。
> `scene.py` 里把 Color Attribute 节点接到 Base Color，否则网页里钟体是纯白。

网页里的联动：

- **握拳** → `contract` 形态键 ↑、动画速率 ↓（收拢、变慢）
- **张开** → `bloom` 形态键 ↑、动画速率 ↑、自发光与粒子增强（绽放）
- 手掌位置 → 整组位移与倾斜

> 注意 1：带蒙皮/形态键的模型导出时**不能** `export_apply=True`，否则动画会被烘掉。
> 注意 2：金色斑点是半透明钟体**之后**才渲染的（`renderOrder = 9`），否则会被蓝色玻璃罩住、变成灰白点。

## 实现要点

**形态驱动**：所有部件都由 uniform 控制，没有一个 morph target。

- `uContract`（0~1）：钟体边缘按 `rimT` 收拢、触手缩短内收
- `uBloom`（0~1）：钟体展平、触手沿径向外扩、粒子沿法线爆开、Bloom 增强
- 律动频率随能量变化：握拳时快而小，张开时慢而大

**手势判定**（`js/gesture.js`）：指尖到腕关节的距离 > 第二指节 × 1.12 记为伸直；
伸直 0~1 根 = 握拳，4~5 根 = 张开，其余为中性。拇指用「离掌心距离」单独判，避免误判。

**输入融合**：`URL 强制 > 摄像头 > 指针/触屏 > 自动演示`，全部落到同一个 `input.energy / bloom / steer`，
所以没有摄像头也能完整调试。

**性能**：DPR 封顶（低端机 1.5）、Bloom 半分辨率、手势推理节流到 24fps、页面隐藏时跳过渲染、
`prefers-reduced-motion` 降级。

---

## 调试参数

| 参数 | 作用 |
| --- | --- |
| `?skip=1` | 跳过开场 |
| `?gesture=open\|fist\|neutral` | 强制某个手势（截图/演示用） |
| `?sim=1` | 合成手部关键点，走完整识别链路 |
| `?camera=1` | 自动申请摄像头（联调用） |
| `?selftest=1` | 只验证 MediaPipe 模型能否加载并跑推理 |
| `?nobloom=1` | 关掉 Bloom（排查性能） |
| `?auto=1` | 自动循环三种手势 |

组合示例：`http://127.0.0.1:5180/?skip=1&gesture=open`

---

## 测试

```bash
node tests/gesture.test.mjs        # 手势判定单测（6 项）
```

浏览器内模型自检：

```bash
node ../site-starter-3d/bin/shot.mjs \
  "http://127.0.0.1:5180/?skip=1&selftest=1" /tmp/self.png --wait 9000 \
  --eval "JSON.stringify(window.__selftest)"
# => {"ok":true,"delegate":"GPU","hands":0}
```

截图验收（移动端尺寸）：

```bash
node ../site-starter-3d/bin/shot.mjs "http://127.0.0.1:5180/?skip=1&gesture=open" /tmp/open.png --w 390 --h 844 --wait 4000
```

---

## 已知限制

- **无摄像头的环境（CI / headless）无法测真实识别**：模型加载与推理已验证，
  手势分类有单测，整条链路可用 `?sim=1` 验证；真实手部需要人工在设备上确认
- MediaPipe 模型 7.5MB + wasm 9MB，首次加载偏慢（本地服务下约 1~2s，之后走缓存）
- iOS Safari 首次授权后若拒绝，需要到「设置 → Safari → 相机」重新允许
- 模型 699 KB（24 条触手 + 54 骨骼），首屏加载约 0.3~0.6s（本地）
- 弱光 / 手掌离镜头太近时识别会抖，`gesture` 在 fist/neutral 之间跳；能量有阻尼，观感上可接受
