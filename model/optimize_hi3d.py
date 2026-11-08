"""把 hi3d 的高模压到网页可用：减面 + 缩贴图 + 可选法线烘焙，导出 GLB。"""
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "model", "dist")
ASSETS = os.path.join(ROOT, "assets")

bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, "model", "hi3d_raw.blend"))
src = next(o for o in bpy.context.scene.objects if o.type == "MESH")
print(f"[opt] source tris={len(src.data.polygons)} verts={len(src.data.vertices)}")

# --- 贴图降到 2K（原图 8192）
for img in bpy.data.images:
    if img.size[0] > 2048:
        img.scale(2048, 2048)
        print(f"[opt] resized {img.name} -> 2048")

# --- 减面：collapse，目标 ~60k 面
target = 60000
ratio = min(1.0, target / len(src.data.polygons))
dec = src.modifiers.new("dec", "DECIMATE")
dec.decimate_type = "COLLAPSE"
dec.ratio = ratio
dec.use_collapse_triangulate = True

bpy.context.view_layer.objects.active = src
bpy.ops.object.modifier_apply(modifier=dec.name)
print(f"[opt] decimated tris={len(src.data.polygons)} verts={len(src.data.vertices)}")

# --- 清理 + 平滑
bpy.ops.object.select_all(action="DESELECT")
src.select_set(True)
bpy.context.view_layer.objects.active = src
bpy.ops.object.shade_smooth()

# --- 导出（Draco 压缩几何，贴图保持 jpeg）
out = os.path.join(ASSETS, "jellyfish.glb")
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
    use_selection=False,
)
print(f"[opt] wrote {out} ({os.path.getsize(out) // 1024} KB)")
