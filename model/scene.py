"""蓝色玻璃水母（Blender → GLB）· v3

参考：model/refs/reference-blue.png（小红书蓝色水母）
     · 钟体分成 8 个圆润的瓣，边缘有奶白色发光斑点
     · 顶部有琥珀色斑点点缀
     · 钟体是玻璃质感的蓝色渐变（顶部近白青，边缘深蓝）
     · 伞下挂着 4 条褶皱口腕，边缘镶着发光白点
     · 外围细长蓝色丝线，夹几根暖橙色细丝

    bl run model/scene.py -- --stage blockout   # 白模
    bl run model/scene.py -- --stage material   # 材质 + 导出 assets/jellyfish.glb
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

import web3d as w

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "model", "dist")
ASSETS = os.path.join(ROOT, "assets")
os.makedirs(DIST, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STAGE = "material"
for i, a in enumerate(argv):
    if a == "--stage" and i + 1 < len(argv):
        STAGE = argv[i + 1]

# ------------------------------------------------------------------ 参数
BELL_SEG, BELL_RING = 128, 34          # 瓣要圆滑，段数给足
BELL_LOBE = 9                          # 伞瓣数量
BELL_THETA = math.radians(118)

FROND_COUNT, FROND_RINGS = 5, 40       # 褶皱口腕
FILAMENT_COUNT, FILAMENT_RINGS = 14, 44  # 细丝
BONES_PER_CHAIN = 8
FPS, LOOP_FRAMES = 24, 108

random.seed(7)


# ------------------------------------------------------------------ 工具
def new_mesh_obj(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob, me


def link_mesh_from(name, verts, faces):
    ob, me = new_mesh_obj(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    me.update()
    return ob


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def add_vertex_colors(obj, color_fn):
    """按顶点位置写入颜色（导出为 COLOR_0，three.js 直接吃）。"""
    layer = obj.data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(obj.data.vertices):
        r, g, b = color_fn(v.co)
        layer.data[i].color = (r, g, b, 1.0)
    return obj


# ------------------------------------------------------------------ 钟体
def bell_point(theta, phi):
    """蘑菇伞盖：饱满的肩部、9 个圆润垂瓣、表面有低频疙瘩。"""
    lobe = math.cos(BELL_LOBE * phi)

    # 肩部更饱满：sin^0.75，顶部更平
    base_r = math.sin(theta) ** 0.78
    r = base_r * 1.12 * (1.0 + 0.11 * lobe)

    z = math.cos(theta) * 0.66
    # 伞沿向内收、向下坠（参考图的边缘是卷下去的）
    drop = max(0.0, (theta - math.radians(62)) / BELL_THETA) * 0.12
    r *= 1.0 - drop * 0.55
    z -= drop * 1.5
    # 垂瓣的起伏
    z += 0.085 * lobe * max(0.0, (theta - math.radians(50)) / BELL_THETA) ** 1.3

    # 表面疙瘩：几个不同频率叠加，做出手办的黏土感
    bump = (0.010 * math.sin(phi * 7.0 + theta * 8.0)
            + 0.007 * math.cos(phi * 11.0 - theta * 5.0)
            + 0.005 * math.sin(phi * 17.0 + theta * 13.0))
    r += bump * (0.35 + 0.65 * math.sin(theta))
    return r, z


def bell_rim():
    r, z = bell_point(BELL_THETA, 0.0)
    return r, z


def build_bell():
    verts, faces = [], []
    for i in range(BELL_RING + 1):
        theta = BELL_THETA * i / BELL_RING
        for j in range(BELL_SEG):
            phi = 2 * math.pi * j / BELL_SEG
            r, z = bell_point(theta, phi)
            verts.append((r * math.cos(phi), r * math.sin(phi), z))

    for i in range(BELL_RING):
        for j in range(BELL_SEG):
            a = i * BELL_SEG + j
            b = i * BELL_SEG + (j + 1) % BELL_SEG
            c = (i + 1) * BELL_SEG + (j + 1) % BELL_SEG
            d = (i + 1) * BELL_SEG + j
            faces.append((a, b, c, d))

    ob = link_mesh_from("bell", verts, faces)
    smooth(ob)

    # 蓝色渐变：顶部近白青 → 边缘深蓝
    top = (0.72, 0.93, 1.0)
    mid = (0.13, 0.52, 0.95)
    edge = (0.03, 0.16, 0.55)

    def color(co):
        h = max(0.0, min(1.0, (co.z + 0.2) / 1.2))
        if h > 0.55:
            k = (h - 0.55) / 0.45
            return tuple(top[c] * k + mid[c] * (1 - k) for c in range(3))
        k = h / 0.55
        return tuple(mid[c] * k + edge[c] * (1 - k) for c in range(3))

    add_vertex_colors(ob, color)

    # 形态键：绽放 / 收拢
    ob.shape_key_add(name="Basis")
    for key_name, sx, sz in (("bloom", 1.16, 0.86), ("contract", 0.82, 1.10)):
        key = ob.shape_key_add(name=key_name)
        for i, v in enumerate(ob.data.vertices):
            key.data[i].co = Vector((v.co.x * sx, v.co.y * sx, v.co.z * sz))

    return ob


# ------------------------------------------------------------------ 斑点
def _sphere_template():
    """细分一次的正八面体 ≈ 12 面球，够圆、面数少。"""
    base_v = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    base_f = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4),
              (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    verts, faces, cache = [], [], {}

    def mid(a, b):
        key = (min(a, b), max(a, b))
        if key not in cache:
            va, vb = verts[a], verts[b]
            v = tuple((va[i] + vb[i]) / 2 for i in range(3))
            n = math.sqrt(sum(c * c for c in v)) or 1.0
            cache[key] = len(verts)
            verts.append(tuple(c / n for c in v))
        return cache[key]

    verts.extend(base_v)
    for a, b, c in base_f:
        ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
        faces.extend([(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)])
    return verts, faces


SPHERE_V, SPHERE_F = _sphere_template()
OCTA_V, OCTA_F = SPHERE_V, SPHERE_F


def build_dots():
    """钟体上铺满的金色发光斑点。"""
    verts, faces = [], []
    rng = random.Random(11)

    for _ in range(144):
        # 按 sin(theta) 做反变换，保证在球面上是面积均匀，而不是挤在边缘
        u = rng.random()
        theta = math.acos(1.0 - u * (1.0 - math.cos(BELL_THETA)))
        phi = rng.random() * math.pi * 2
        r, z = bell_point(theta, phi)
        p = Vector((r * math.cos(phi), r * math.sin(phi), z)) * 1.012
        size = 0.013 + rng.random() ** 2 * 0.016

        base = len(verts)
        for vx, vy, vz in SPHERE_V:
            verts.append((p.x + vx * size, p.y + vy * size, p.z + vz * size))
        for f in SPHERE_F:
            faces.append(tuple(base + i for i in f))

    ob = link_mesh_from("dots_gold", verts, faces)
    smooth(ob)
    return ob


# ------------------------------------------------------------ 褶皱口腕
def frond_path(t, k):
    ang = 2 * math.pi * k / FROND_COUNT + 0.5
    r = 0.16 + (0.46 + 0.30 * math.sin(k * 1.3)) * (t ** 0.5)
    z = 0.06 - t * 2.35
    return Vector((math.cos(ang) * r, math.sin(ang) * r, z)), ang


def build_margin_arms(count=12, rings=10):
    """伞沿一圈粗短口腕（参考图里钟体下方那一圈钝头触须）。"""
    verts, faces = [], []

    def path(t, k):
        ang = 2 * math.pi * k / count + 0.26
        r = 0.96 + 0.06 * math.sin(t * 3.0)
        z = -0.10 - t * 0.95 + 0.04 * math.sin(t * 4.0 + k)
        return Vector((math.cos(ang) * r, math.sin(ang) * r, z)), ang

    for k in range(count):
        base = len(verts)
        for s_ in range(rings + 1):
            t = s_ / rings
            c, ang = path(t, k)
            ca, sa = math.cos(ang), math.sin(ang)
            radius = 0.105 * (1 - 0.70 * t) + 0.018
            for j in range(6):
                b = 2 * math.pi * j / 6
                verts.append((c.x + ca * math.cos(b) * radius,
                              c.y + sa * math.cos(b) * radius,
                              c.z + math.sin(b) * radius))
        for s_ in range(rings):
            a = base + s_ * 6
            b = a + 6
            for j in range(6):
                j2 = (j + 1) % 6
                faces.append((a + j, a + j2, b + j2, b + j))

    ob = link_mesh_from("arms", verts, faces)
    smooth(ob)
    return ob


def build_fronds():
    """5 条宽大褶皱薄膜；左右两侧各加一条细边，用发光材质做"蕾丝边"。"""
    verts, faces, weights, edge_faces = [], [], [], []
    SEG_X = 9                      # 横向分段（褶皱）
    row = SEG_X + 3                # 左边缘 + 9 段(10 点) + 右边缘

    for k in range(FROND_COUNT):
        base = len(verts)
        for s in range(FROND_RINGS + 1):
            t = s / FROND_RINGS
            c, ang = frond_path(t, k)
            ca, sa = math.cos(ang), math.sin(ang)
            width = (0.26 * (1.0 - 0.5 * t)) * (1.0 + 0.30 * math.sin(t * 9 + k)) * (1.0 + 0.18 * math.sin(t * 22.0 + k * 2.0))

            def push(u, extra=0.0):
                ruffle = math.sin(u * 6.0 + t * 9.0 + k * 2.0) * 0.105 * (0.3 + t)
                edge_wave = math.sin(t * 11 + k * 3) * 0.05 * abs(u) ** 2
                off = width * u * (1.0 + extra)
                verts.append((c.x + (-sa) * off + ca * ruffle,
                              c.y + ca * off + sa * ruffle,
                              c.z + edge_wave))
                weights.append(t)

            push(-1.06, 0.0)                 # 左边缘
            for sx in range(SEG_X + 1):
                push(sx / SEG_X * 2 - 1)
            push(1.06, 0.0)                  # 右边缘

        for s in range(FROND_RINGS):
            a = base + s * row
            b = a + row
            # 左右两条发光边
            edge_faces.append((a, a + 1, b + 1, b))
            edge_faces.append((a + row - 2, a + row - 1, b + row - 1, b + row - 2))
            # 中间的薄膜
            for sx in range(1, SEG_X + 1):
                faces.append((a + sx, a + sx + 1, b + sx + 1, b + sx))

    ob = link_mesh_from("fronds", verts, faces + edge_faces)
    ob.data.materials.append(None)
    ob.data.materials.append(None)
    offset = len(faces)
    for i in range(offset, len(faces) + len(edge_faces)):
        ob.data.polygons[i].material_index = 1
    smooth(ob)
    return ob, weights


# ------------------------------------------------------------------ 细丝
def filament_length(k):
    return 3.2 + 1.3 * ((k * 7) % 9) / 8.0


def filament_path(t, k):
    """触须静止曲线。

    根部收拢在伞盖正下方（r≈0.2）并略微伸进钟体内部，
    随 t 平滑地向外散开 —— 这样根部不会从伞沿"切断"出来，
    而是从头冠下方长出去，衔接更自然。
    """
    ang0 = 2 * math.pi * k / FILAMENT_COUNT + 0.15 * math.sin(k * 2.3)
    length = filament_length(k)

    r_root = 0.18 + 0.07 * math.sin(k * 1.7)
    r_max = 0.78 + 0.25 * math.sin(k * 0.9)
    grow = t ** 0.55                                   # 根部慢、梢部散
    r = r_root + (r_max - r_root) * grow + 0.10 * math.sin(t * 3.2 + k)

    ang = ang0 + 0.95 * math.sin(t * 2.1 + k * 0.8) + 0.34 * math.cos(t * 4.4 + k * 1.9)

    z = 0.12 - t * (length + 0.12)                     # 起点在钟体内部
    return Vector((math.cos(ang) * r, math.sin(ang) * r, z)), ang


def filament_frame(t, k):
    """局部坐标系：S 为带宽方向，B 为厚度方向。"""
    eps = 1e-3
    p, ang = filament_path(t, k)
    p0, _ = filament_path(max(0.0, t - eps), k)
    p1, _ = filament_path(min(1.0, t + eps), k)
    T = (p1 - p0).normalized()
    R = Vector((p.x, p.y, 0.0))
    R = R.normalized() if R.length > 1e-4 else Vector((1.0, 0.0, 0.0))
    S = R.cross(T)
    S = S.normalized() if S.length > 1e-4 else Vector((1.0, 0.0, 0.0))
    B = T.cross(S).normalized()
    return p, S, B


def build_filaments():
    """触须：宽飘带截面（宽 0.055 / 厚 0.011）。

    截面 6 个顶点：左缘、中缝、右缘 各一层上下，
    中缝略微隆起形成折痕，顶点色让边缘更亮 —— 看起来像有厚度的布带子。
    """
    verts, faces, weights, colors = [], [], [], []
    COLS = (-1.0, 0.0, 1.0)

    for k in range(FILAMENT_COUNT):
        base = len(verts)
        for s in range(FILAMENT_RINGS + 1):
            t = s / FILAMENT_RINGS
            c, S, B = filament_frame(t, k)
            # 带宽沿长度收窄，并叠加低频起伏，边缘才是波浪不是直线
            w = 0.082 * (1.0 - 0.35 * t) * (1.0 + 0.16 * math.sin(t * 7.0 + k * 1.3))
            h = 0.012 * (0.5 - 0.18 * t)

            twist = math.sin(t * 5.0 + k * 1.7) * 0.45
            ct, st_ = math.cos(twist), math.sin(twist)

            def push(u, side, shade):
                # side: +1 上表面, -1 下表面；中缝抬高做出折痕
                fold = 1.0 if u == 0.0 else 0.0
                off_b = side * h * (1.0 + 0.5 * fold)
                dx = u * w * ct - off_b * st_
                dy = u * w * st_ + off_b * ct
                verts.append((c.x + S.x * dx + B.x * dy,
                              c.y + S.y * dx + B.y * dy,
                              c.z + S.z * dx + B.z * dy))
                weights.append(t)
                fade_in = min(1.0, t / 0.14)              # 根部淡入，藏住截断
                fade_out = max(0.04, (1.0 - t) ** 1.5)    # 梢部淡出
                colors.append((shade, shade, shade, fade_in * fade_out))

            for u in COLS:                    # 上表面：左→中→右
                push(u, +1, 1.15 if abs(u) == 1.0 else 0.85)
            for u in reversed(COLS):          # 下表面：右→中→左
                push(u, -1, 0.9 if abs(u) == 1.0 else 0.7)

        ring = 6
        for s in range(FILAMENT_RINGS):
            a = base + s * ring
            b = a + ring
            for j in range(ring):
                j2 = (j + 1) % ring
                faces.append((a + j, a + j2, b + j2, b + j))

    ob = link_mesh_from("filaments", verts, faces)
    smooth(ob)

    layer = ob.data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, col in enumerate(colors):
        layer.data[i].color = col
    return ob, weights


# ------------------------------------------------------------------ 骨架
def build_rig(chain_defs):
    """chain_defs: [(name, path_fn, count), ...]"""
    arm_data = bpy.data.armatures.new("jelly_rig")
    rig = bpy.data.objects.new("jelly_rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    chains = {}
    for label, path_fn, count in chain_defs:
        parent = None
        names = []
        for k in range(count):
            chain = []
            for b in range(BONES_PER_CHAIN):
                t0, t1 = b / BONES_PER_CHAIN, (b + 1) / BONES_PER_CHAIN
                head, _ = path_fn(t0, k)
                tail, _ = path_fn(t1, k)
                eb = arm_data.edit_bones.new(f"{label}{k}_b{b}")
                eb.head, eb.tail = head, tail
                if parent:
                    eb.parent = parent
                    eb.use_connect = True
                parent = eb if b == 0 else eb
                chain.append(eb.name)
            names.append(chain)
            parent = None
        chains[label] = names

    bpy.ops.object.mode_set(mode="OBJECT")
    return rig, chains


def skin(mesh_obj, rig, chains, weights, ring_verts):
    """chains: [[bone, bone, ...], ...]（每条链一个列表）；ring_verts: 每环顶点数"""
    mesh_obj.parent = rig
    mod = mesh_obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    groups = {}
    for chain in chains:
        for name in chain:
            groups[name] = mesh_obj.vertex_groups.new(name=name)

    per_chain = ring_verts * (len(weights) // ring_verts // len(chains))
    for idx, t in enumerate(weights):
        k = min(idx // per_chain, len(chains) - 1)
        chain = chains[k]
        f = min(t * BONES_PER_CHAIN, BONES_PER_CHAIN - 1e-6)
        i0 = int(f)
        i1 = min(i0 + 1, BONES_PER_CHAIN - 1)
        frac = f - i0
        pairs = [(chain[i0], 1.0)] if i1 == i0 else [(chain[i0], 1.0 - frac), (chain[i1], frac)]
        for name, wgt in pairs:
            if wgt > 0:
                groups[name].add([idx], wgt, "ADD")


def animate_rig(rig, chains, amp_scale=1.0):
    """用弹簧跟随代替纯正弦：梢部滞后，产生"水感"的跟随拖尾。"""
    scn = bpy.context.scene
    scn.render.fps = FPS
    scn.frame_start, scn.frame_end = 1, LOOP_FRAMES

    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"

    steps = 30
    state = {}

    def targets(phase):
        out = {}
        for label, chain_list in chains.items():
            soft = 0.55 if label == "frond" else 1.0
            for k, chain in enumerate(chain_list):
                for i, name in enumerate(chain):
                    amp = (0.07 + i * 0.05) * amp_scale * soft * (1.0 + 0.35 * math.sin(k * 1.7))
                    out[name] = (
                        (math.sin(phase - i * 0.55 + k * 0.9)
                         + 0.55 * math.sin(phase * 2.0 - i * 0.4 + k * 2.1)) * amp,
                        math.cos(phase * 0.6 + i * 0.5 + k) * amp * 0.45,
                        (math.cos(phase - i * 0.5 + k * 1.4)
                         + 0.4 * math.cos(phase * 1.7 - i * 0.3 + k)) * amp * 0.7,
                    )
        return out

    def advance(phase):
        tgt = targets(phase)
        for name, (tx, ty, tz) in tgt.items():
            st = state.setdefault(name, [0.0, 0.0, 0.0])
            # 刚度沿链条递减：根节跟得紧，梢节拖得久
            i = int(name.rsplit("_b", 1)[1])
            stiff = max(0.12, 0.62 - 0.055 * i)
            st[0] += (tx - st[0]) * stiff
            st[1] += (ty - st[1]) * stiff
            st[2] += (tz - st[2]) * stiff

    # 预热两圈，让循环接缝处也有连贯的相位
    for warm in range(steps * 2 + 1):
        advance(2 * math.pi * warm / steps)

    for s in range(steps + 1):
        phase = 2 * math.pi * s / steps
        advance(phase)
        frame = 1 + s * (LOOP_FRAMES / steps)
        for name, st in state.items():
            pb = rig.pose.bones[name]
            pb.rotation_euler = (st[0], st[1], st[2])
            pb.keyframe_insert("rotation_euler", frame=frame)


# ------------------------------------------------------------------ 材质
def make_materials():
    def blended(m):
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            try:
                m.blend_method = "BLEND"
            except Exception:
                pass
        m.use_backface_culling = False
        return m

    bell = blended(w.material("jelly_bell", "#ffffff", roughness=0.12, metallic=0.0,
                              emission="#4a97f0", emission_strength=0.42, alpha=0.38))
    collar = blended(w.material("jelly_collar", "#a6d8ff", roughness=0.2,
                                emission="#5fa8f0", emission_strength=0.55, alpha=0.30))
    gold_dots = w.material("jelly_dots_gold", "#ffc65a", roughness=0.22,
                           emission="#ffae2e", emission_strength=3.2, alpha=1.0)
    frond = blended(w.material("jelly_frond", "#8fd0ff", roughness=0.22,
                               emission="#7fc4ff", emission_strength=0.55, alpha=0.22))
    edge = blended(w.material("jelly_edge", "#eaf8ff", roughness=0.2,
                              emission="#cfeaff", emission_strength=1.1, alpha=0.65))
    fil_blue = blended(w.material("jelly_fil_blue", "#7fc4ff", roughness=0.3,
                                  emission="#5ec8ff", emission_strength=2.2, alpha=0.9))
    fil_warm = blended(w.material("jelly_fil_warm", "#ffcf9a", roughness=0.3,
                                  emission="#ffc98a", emission_strength=2.8, alpha=0.92))
    return bell, gold_dots, frond, edge, fil_blue, fil_warm, collar


# ------------------------------------------------------------------ 组装
def build_collar(rings=18, segs=96):
    """伞下的过渡膜（裙边）。

    从伞沿一路收进中心并向下坠，把飘带的根部连成一片；
    底边用顶点 alpha 淡出，自然融进触须。
    """
    r0, z0 = bell_rim()
    verts, faces, cols = [], [], []

    for i in range(rings + 1):
        t = i / rings
        rr = r0 * 0.99 * (1.0 - 0.86 * (t ** 0.85))
        zz = z0 - 0.62 * t
        for j in range(segs):
            a = 2 * math.pi * j / segs
            scallop = math.sin(a * 8) * 0.04 * (t ** 2)
            verts.append((math.cos(a) * rr, math.sin(a) * rr, zz + scallop))
            shade = 0.72 + 0.28 * (1 - t)
            alpha = (1 - t) ** 1.2 * min(1.0, t / 0.03)
            cols.append((shade, shade, shade, alpha))

    for i in range(rings):
        for j in range(segs):
            a = i * segs + j
            b = i * segs + (j + 1) % segs
            c = (i + 1) * segs + (j + 1) % segs
            d = (i + 1) * segs + j
            faces.append((a, b, c, d))

    ob = link_mesh_from("collar", verts, faces)
    smooth(ob)
    layer = ob.data.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(cols):
        layer.data[i].color = c
    return ob


def build_all(with_material=True):
    w.reset()
    w.setup(resolution=(1200, 1500), samples=64, transparent=True, exposure=0.0)

    bell = build_bell()
    arms = build_margin_arms()
    collar = build_collar()
    dots = build_dots()

    fronds, frond_w = build_fronds()
    fils, fil_w = build_filaments()

    rig, chains = build_rig([
        ("frond", frond_path, FROND_COUNT),
        ("fil", filament_path, FILAMENT_COUNT),
    ])

    skin(fronds, rig, chains["frond"], frond_w, 10)         # 横向 9 段 → 10 个点
    skin(fils, rig, chains["fil"], fil_w, 6)                # 飘带截面 → 6 个点

    for ob in (bell, arms, collar, dots):
        ob.parent = rig
        ob.matrix_parent_inverse = rig.matrix_world.inverted()

    animate_rig(rig, chains)

    if with_material:
        m_bell, m_gold_dots, m_frond, m_edge, m_blue, m_warm, m_collar = make_materials()
        # 关键：把顶点色节点接到 Base Color，glTF 才会导出 COLOR_0
        nt = m_bell.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if bsdf and "Col" in {a.name for a in bell.data.color_attributes}:
            vcol = nt.nodes.new("ShaderNodeVertexColor")
            vcol.layer_name = "Col"
            nt.links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
        w.assign(bell, m_bell)
        w.assign(arms, m_frond)
        w.assign(collar, m_collar)
        w.assign(dots, m_gold_dots)
        fronds.data.materials[0] = m_frond
        fronds.data.materials[1] = m_edge
        fils.data.materials.clear()
        for m in (m_blue, m_warm):
            fils.data.materials.append(m)
        per = FILAMENT_RINGS * 6
        for k in range(FILAMENT_COUNT):
            idx = 1 if k % 6 == 0 else 0          # 每隔 6 根插一根暖色丝
            for f in range(per):
                fils.data.polygons[k * per + f].material_index = idx
    else:
        grey = w.material("blockout", "#9a9a9a", roughness=0.9)
        for ob in (bell, arms, collar, dots, fronds, fils):
            w.assign(ob, grey)

    return {"bell": bell, "arms": arms, "collar": collar, "dots": dots,
            "fronds": fronds, "filaments": fils, "rig": rig}


# ------------------------------------------------------------------ 渲染
def look():
    w.env_light("#061020", 0.35)
    w.area("key", location=(3.0, -3.6, 3.4), energy=90, size=4.5, target=(0, 0, 0.4))
    w.area("fill", location=(-3.6, -1.8, 1.2), energy=35, size=6.0,
           color="#8fd0ff", target=(0, 0, 0))
    w.area("rim", location=(0.6, 3.4, 2.4), energy=70, size=3.0,
           color="#cfe8ff", target=(0, 0, 0.3))


def shot_views(prefix):
    cams = [
        ("front", (0.2, -8.8, 0.9), (0, 0, -1.35), 55),
        ("three_quarter", (4.8, -7.6, 1.3), (0, 0, -1.35), 55),
        ("side", (8.2, 0.6, 1.0), (0, 0, -1.35), 55),
    ]
    out = []
    for name, pos, target, focal in cams:
        w.camera(name="cam_" + name, position=pos, target=target, focal=focal)
        bpy.context.scene.camera = bpy.data.objects["cam_" + name]
        out.append(w.render(os.path.join(DIST, f"{prefix}_{name}.png")))
    return out


if STAGE == "clay":
    # 白模渲染：和你给的 neural4d 截图对照，确认几何是 Blender 里建出来的
    build_all(with_material=False)
    clay = w.material("clay", "#d8d8d8", roughness=0.62, metallic=0.0)
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            w.assign(ob, clay)
    bpy.context.scene.world = bpy.data.worlds.new("clayworld")
    bpy.context.scene.world.color = (0.08, 0.08, 0.09)
    w.setup(resolution=(760, 1000), samples=48, transparent=False, exposure=0.15)
    w.env_light("#3a3d44", 1.1)
    w.area("key", location=(2.6, -3.4, 3.2), energy=420, size=3.2, target=(0, 0, 0.2))
    w.area("fill", location=(-3.0, -1.4, 1.0), energy=140, size=5.0, target=(0, 0, -0.2))
    views = []
    for name, pos, target, focal in (
        ("front", (0.1, -7.6, 1.0), (0, 0, -1.5), 52),
        ("three_quarter", (3.6, -6.6, 1.6), (0, 0, -1.5), 52),
        ("top", (0.3, -5.2, 3.4), (0, 0, -0.6), 46),
    ):
        w.camera(name="clay_" + name, position=pos, target=target, focal=focal)
        bpy.context.scene.camera = bpy.data.objects["clay_" + name]
        views.append(w.render(os.path.join(DIST, f"clay_{name}.png")))
    print("[jelly] 白模渲染:", views)
elif STAGE == "blockout":
    build_all(with_material=False)
    look()
    print("[jelly] 白模:", shot_views("blockout"))
    tri = sum(len(p.vertices) - 2 for o in bpy.context.scene.objects
              if o.type == "MESH" for p in o.data.polygons)
    print("[jelly] 三角面:", tri, "骨骼:", len(bpy.data.objects["jelly_rig"].data.bones))
else:
    build_all(with_material=True)
    look()
    print("[jelly] 预览:", shot_views("preview"))
    bpy.context.scene.frame_set(27)

    out = os.path.join(ASSETS, "jellyfish.glb")
    path = w.export_glb(out, export_apply=False,
                        export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                        export_draco_mesh_compression_enable=True,
                        export_draco_mesh_compression_level=6)
    print(f"[jelly] 已导出 {path} ({os.path.getsize(path)//1024} KB)")
    print("[jelly] 场景信息:", w.scene_info())
