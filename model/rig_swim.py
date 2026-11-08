"""在 Blender 里给 hi3d 雕塑绑骨骼，并烘焙一段"游动"循环动画。

动作参考：96c177e13d7bbd45bc3161a7439e58b9.MP4（白模水母游动）
    · 伞盖节律收缩（发力快、放松慢）
    · 身体左右轻微摆动
    · 触手作为拖尾，相位滞后地跟随

导出：assets/jellyfish.glb（含骨骼 + 动画）
"""
import math
import os

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
TARGET_TRIS = 60000
BONES = 10
FPS, FRAMES = 24, 96

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "model", "hi3d_raw.blend"))
src = next(o for o in bpy.context.scene.objects if o.type == "MESH")

# 贴图降到 2K
for img in bpy.data.images:
    if img.size[0] > 2048:
        img.scale(2048, 2048)

# 减面
ratio = min(1.0, TARGET_TRIS / len(src.data.polygons))
mod = src.modifiers.new("dec", "DECIMATE")
mod.decimate_type = "COLLAPSE"
mod.ratio = ratio
mod.use_collapse_triangulate = True
bpy.context.view_layer.objects.active = src
bpy.ops.object.modifier_apply(modifier=mod.name)
print(f"[rig] tris={len(src.data.polygons)} verts={len(src.data.vertices)}")

# 统一尺寸与位置：高 5、底部落地
bpy.ops.object.select_all(action="DESELECT")
src.select_set(True)
bpy.context.view_layer.objects.active = src
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for v in src.data.vertices:
    p = src.matrix_world @ v.co
    lo = Vector((min(lo[i], p[i]) for i in range(3)))
    hi = Vector((max(hi[i], p[i]) for i in range(3)))
size = hi - lo
s = 5.0 / max(size.x, size.y, size.z)
src.scale = (s, s, s)
bpy.ops.object.transform_apply(scale=True)

lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for v in src.data.vertices:
    p = src.matrix_world @ v.co
    lo = Vector((min(lo[i], p[i]) for i in range(3)))
    hi = Vector((max(hi[i], p[i]) for i in range(3)))
for v in src.data.vertices:
    pass
src.location = (-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)
bpy.ops.object.transform_apply(location=True)
bpy.context.view_layer.update()

# 重新量高度范围
zs = [ (src.matrix_world @ v.co).z for v in src.data.vertices ]
zMin, zMax = min(zs), max(zs)
print(f"[rig] z {zMin:.2f} .. {zMax:.2f}")

# --- 骨架：从伞盖顶部往下 10 根骨
arm_data = bpy.data.armatures.new("swim_rig")
rig = bpy.data.objects.new("swim_rig", arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")

seg = (zMax - zMin) / BONES
names = []
parent = None
for i in range(BONES):
    head = Vector((0, 0, zMax - i * seg))
    tail = Vector((0, 0, zMax - (i + 1) * seg))
    eb = arm_data.edit_bones.new(f"b{i}")
    eb.head, eb.tail = head, tail
    if parent:
        eb.parent = parent
        eb.use_connect = True
    parent = eb
    names.append(eb.name)
bpy.ops.object.mode_set(mode="OBJECT")

# --- 蒙皮：按高度分配权重（相邻两骨平滑混合）
for n in names:
    src.vertex_groups.new(name=n)
groups = {vg.name: vg for vg in src.vertex_groups}

for vi, v in enumerate(src.data.vertices):
    z = (src.matrix_world @ v.co).z
    f = (zMax - z) / seg              # 0 在顶，BONES 在底
    i0 = max(0, min(BONES - 1, int(f)))
    i1 = min(BONES - 1, i0 + 1)
    frac = max(0.0, min(1.0, f - i0))
    if i1 == i0:
        groups[names[i0]].add([vi], 1.0, "REPLACE")
    else:
        groups[names[i0]].add([vi], 1.0 - frac, "REPLACE")
        groups[names[i1]].add([vi], frac, "REPLACE")

src.parent = rig
m = src.modifiers.new("Armature", "ARMATURE")
m.object = rig

# --- 动画：伞盖搏动 + 触手拖尾（相位滞后）
scn = bpy.context.scene
scn.render.fps = FPS
scn.frame_start, scn.frame_end = 1, FRAMES
for pb in rig.pose.bones:
    pb.rotation_mode = "XYZ"

STEPS = 32
for st in range(STEPS + 1):
    frame = 1 + st * (FRAMES / STEPS)
    phase = 2 * math.pi * st / STEPS

    # 搏动：快收慢放
    k = st / STEPS
    pulse = (1 - (k / 0.22)) if k < 0.22 else (
        (k - 0.22) / 0.78)
    pulse = math.sin(min(1.0, max(0.0, 1 - abs(k - 0.22) / 0.22)) * math.pi * 0.5) if k < 0.22 else \
        max(0.0, 1 - (k - 0.22) / 0.5)

    for i, name in enumerate(names):
        pb = rig.pose.bones[name]
        lag = i * 0.55                     # 越往下相位越滞后
        amp = 0.03 + i * 0.02              # 越往下摆得越大
        wave = math.sin(phase - lag)
        wave2 = math.cos(phase * 0.5 - lag * 0.6)

        pb.rotation_euler = (
            wave * amp * 0.5,              # 前后
            math.sin(phase * 0.5 + i * 0.4) * amp * 0.3,
            wave2 * amp,                   # 左右（游动的侧倾）
        )
        # 伞盖骨头缩放：收缩时横向收窄、纵向拉长
        if i < 3:
            squeeze = pulse * (0.16 if i == 0 else 0.10)
            pb.scale = (1 - squeeze, 1 + squeeze * 0.45, 1 - squeeze)
        else:
            pb.scale = (1.0, 1.0, 1.0)
        pb.keyframe_insert("rotation_euler", frame=frame)
        pb.keyframe_insert("scale", frame=frame)

# 根骨轻微整体侧倾 + 上下浮动
root = rig.pose.bones[names[0]]
for st in range(STEPS + 1):
    frame = 1 + st * (FRAMES / STEPS)
    phase = 2 * math.pi * st / STEPS
    root.location = (math.sin(phase) * 0.05, 0.0, math.sin(phase * 2) * 0.06)
    root.keyframe_insert("location", frame=frame)

out = os.path.join(ASSETS, "jellyfish.glb")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_apply=False,
    export_yup=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    use_selection=False,
)
print(f"[rig] wrote {out} ({os.path.getsize(out)//1024} KB)")
