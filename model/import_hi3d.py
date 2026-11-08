"""导入 hi3d 的 GLB，检查尺寸/材质，并渲染几张白模预览。"""
import os
import sys

import bpy
from mathutils import Vector

import web3d as w

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "model", "dist")
SRC = "/Users/xuyi/Downloads/hi3d-jellyfish_1.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
total_v = sum(len(o.data.vertices) for o in meshes)
total_f = sum(len(o.data.polygons) for o in meshes)

# 包围盒
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        lo = Vector((min(lo[i], p[i]) for i in range(3)))
        hi = Vector((max(hi[i], p[i]) for i in range(3)))
size = hi - lo
print(f"[hi3d] meshes={len(meshes)} verts={total_v} faces={total_f}")
print(f"[hi3d] bounds size={tuple(round(x,3) for x in size)} center={tuple(round((lo[i]+hi[i])/2,3) for i in range(3))}")
for o in meshes:
    print(f"[hi3d] obj={o.name} mats={[m.name for m in o.data.materials]}")
    for img in bpy.data.images:
        if img.size[0]:
            print(f"[hi3d] image={img.name} {img.size[0]}x{img.size[1]}")

# 统一尺寸：缩放到高 5、水平居中、底部落地
s = 5.0 / max(size.x, size.y, size.z)
for o in meshes:
    o.scale = (o.scale.x * s, o.scale.y * s, o.scale.z * s)
    o.location = (0, 0, 0)
bpy.context.view_layer.objects.active = meshes[0]
for o in meshes:
    o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

lo2 = Vector((1e9, 1e9, 1e9)); hi2 = Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        lo2 = Vector((min(lo2[i], p[i]) for i in range(3)))
        hi2 = Vector((max(hi2[i], p[i]) for i in range(3)))
for o in meshes:
    o.location = (-(lo2.x + hi2.x) / 2, -(lo2.y + hi2.y) / 2, -lo2.z)
bpy.context.view_layer.update()
print("[hi3d] final size", tuple(round(x, 2) for x in (hi2 - lo2)))

w.setup(resolution=(760, 1000), samples=48, transparent=False, exposure=0.1)
bpy.context.scene.world = bpy.data.worlds.new("W")
w.env_light("#3a3d44", 1.2)
w.area("key", location=(2.6, -3.6, 3.4), energy=500, size=3.2, target=(0, 0, 0.4))
w.area("fill", location=(-3.2, -1.6, 1.2), energy=160, size=5.0, target=(0, 0, 0))

for name, pos, target, focal in (
    ("front", (0.1, -9.0, 1.2), (0, 0, 0.0), 52),
    ("three_quarter", (4.2, -8.0, 1.8), (0, 0, 0.0), 52),
    ("side", (9.0, 0.6, 1.2), (0, 0, 0.0), 52),
):
    w.camera(name="c_" + name, position=pos, target=(0, 0, 2.4), focal=focal)
    bpy.context.scene.camera = bpy.data.objects["c_" + name]
    print("[hi3d] render", w.render(os.path.join(DIST, f"hi3d_{name}.png")))

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "model", "hi3d_raw.blend"))
print("[hi3d] saved model/hi3d_raw.blend")
