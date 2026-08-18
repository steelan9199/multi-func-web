#!/usr/bin/env python3
"""Convert an image (PNG/JPG/...) to a multi-resolution Windows .ico file.

Strategy: render each target resolution with Pillow (LANCZOS), then embed every
frame as a PNG inside the ICO container (PNG-in-ICO, supported on all modern
Windows). This deliberately avoids Pillow's unreliable built-in multi-frame ICO
encoder, which on several Pillow builds only writes a single frame.

Non-square inputs are center-cropped (横向 + 纵向居中) to a square before
resizing, so the icon never looks stretched.

Output write is hardened: it is written to a temp file first and then atomically
replaced. If the preferred path is locked (e.g. the .ico is currently in use as
an active icon in Explorer), it falls back to a numbered alternate name
(e.g. name.1.ico) so the job still succeeds.

Usage:
    python png_to_ico.py <input_image> <output.ico> [size1 size2 ...]
When no sizes are given, defaults to 16 24 32 48 64 128 256.
Requires Pillow (pip install Pillow), e.g. in the managed Python venv.

Prints exactly one line on success:  ICO_WRITTEN <actual_output_path>
"""
import io
import os
import struct
import sys

from PIL import Image

DEFAULT_SIZES = [16, 24, 32, 48, 64, 128, 256]


def center_crop(img):
    """Crop to the largest centered square (横向、纵向都居中)."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def build_ico(src_path: str, dst_path: str, sizes) -> str:
    img = Image.open(src_path)
    if img.mode != "RGBA":
        img = img.convert("RGBA")

    # 非正方形 -> 居中裁剪为正方形，避免图标被拉伸
    img = center_crop(img)

    # Render each resolution as a standalone PNG (RGBA).
    frames = []
    for s in sizes:
        buf = io.BytesIO()
        img.resize((s, s), Image.Resampling.LANCZOS).save(buf, format="PNG")
        frames.append(buf.getvalue())

    # Build the ICO container manually.
    # ICONDIR: reserved(0) u16, type(1=ICO) u16, count u16  -> 6 bytes
    # Each ICONDIRENTRY: 16 bytes -> width, height, colorCount, reserved,
    #   planes u16, bitCount u16, bytesInRes u32, imageOffset u32
    out = io.BytesIO()
    out.write(struct.pack("<HHH", 0, 1, len(frames)))
    data_offset = 6 + 16 * len(frames)
    offset = data_offset
    for s, png in zip(sizes, frames):
        size = len(png)
        # Width/Height fields are 1 byte; 0 means 256.
        w = s if s < 256 else 0
        h = s if s < 256 else 0
        out.write(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, size, offset))
        offset += size
    for png in frames:
        out.write(png)

    data = out.getvalue()
    return safe_write(dst_path, data)


def safe_write(dst: str, data: bytes) -> str:
    """Write bytes to dst, hardened against locked files.

    Returns the actual path written. If the preferred path is locked, falls
    back to a numbered alternate name (name.1.ico, name.2.ico, ...).
    """
    parent = os.path.dirname(dst) or "."
    os.makedirs(parent, exist_ok=True)

    base, ext = os.path.splitext(dst)
    last_err = None
    for i in range(0, 100):
        candidate = dst if i == 0 else f"{base}.{i}{ext}"
        tmp = candidate + ".tmp"
        try:
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, candidate)
            return candidate
        except OSError as e:
            last_err = e
            try:
                os.remove(tmp)
            except OSError:
                pass
            # i == 0 失败（多半是被占用）-> 换编号文件名重试
            if i == 0:
                continue
            raise
    raise OSError(f"无法写入图标文件 {dst}: {last_err}")


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: python png_to_ico.py <input_image> <output.ico> [sizes...]")
        sys.exit(2)

    src = sys.argv[1]
    dst = sys.argv[2]
    sizes = [int(s) for s in sys.argv[3:]] if len(sys.argv) > 3 else DEFAULT_SIZES

    actual = build_ico(src, dst, sizes)
    print(f"ICO_WRITTEN {actual}")


if __name__ == "__main__":
    main()
