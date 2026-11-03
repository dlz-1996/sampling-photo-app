# -*- coding: utf-8 -*-
"""生成 Android 启动图标（自适应前景 + 各密度兜底）。

运行：python android/tools/gen_icons.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(os.path.dirname(HERE), "app", "src", "main", "res")

FONTS = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]
RED = (178, 58, 43, 255)
RED_DARK = (150, 43, 31, 255)
CREAM = (255, 246, 237, 255)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
    return ImageFont.load_default()


def draw_glyph(img, d, S, ratio, dy=0.0, underline=True, color=CREAM):
    f = font(int(S * ratio))
    bbox = d.textbbox((0, 0), "抽", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (S - tw) / 2 - bbox[0]
    ty = (S - th) / 2 - bbox[1] + S * dy
    d.text((tx, ty), "抽", font=f, fill=color)
    if underline:
        lw = int(S * 0.26)
        y = int(S * (0.5 + ratio * 0.62))
        d.line([(S - lw) / 2, y, (S + lw) / 2, y], fill=(255, 246, 237, 170),
               width=max(2, S // 200))


def adaptive_foreground(size):
    """108dp 画布，内容限定在中心安全区（约 66%），背景由 XML 提供"""
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_glyph(img, d, S, 0.40, dy=-0.015, underline=True)
    return img.resize((size, size), Image.LANCZOS)


def legacy_icon(size, round_mask=False):
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * 0.20)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=RED)
    pad = int(S * 0.05)
    d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                        radius=int(r * 0.8), outline=(255, 246, 237, 90),
                        width=max(2, S // 160))

    grad = Image.new("L", (1, S), 0)
    for y in range(S):
        grad.putpixel((0, y), int(36 * (y / S) ** 2))
    dark = Image.new("RGBA", (S, S), RED_DARK)
    img = Image.composite(dark, img, grad.resize((S, S)))

    d = ImageDraw.Draw(img)
    draw_glyph(img, d, S, 0.56, dy=-0.015, underline=True)

    if round_mask:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, S - 1, S - 1], fill=255)
        out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        out.paste(img, (0, 0), mask)
        img = out
    return img.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    p = os.path.join(RES, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p)


for name, scale in DENSITIES.items():
    # 自适应图层：108dp
    save(adaptive_foreground(int(108 * scale)), "mipmap-" + name, "ic_launcher_foreground.png")
    # 传统图标兜底
    save(legacy_icon(int(48 * scale)), "mipmap-" + name, "ic_launcher.png")
    save(legacy_icon(int(48 * scale), round_mask=True), "mipmap-" + name, "ic_launcher_round.png")

print("android icons generated ->", RES)
