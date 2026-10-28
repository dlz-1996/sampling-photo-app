# -*- coding: utf-8 -*-
"""生成 App 图标（印章红 + 抽字）。运行：python icons/_gen_icons.py"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = [
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]
RED = (178, 58, 43, 255)
RED_DARK = (150, 43, 31, 255)
CREAM = (255, 246, 237, 255)

def font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
    return ImageFont.load_default()

def make(size, maskable=False):
    S = size * 3
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=RED)
    else:
        r = int(S * 0.19)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=RED)
        # 内描边
        pad = int(S * 0.045)
        d.rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad],
                            radius=int(r * 0.8), outline=(255, 246, 237, 90), width=max(2, S // 170))
    # 底部压暗，增加层次
    grad = Image.new("L", (1, S), 0)
    for y in range(S):
        grad.putpixel((0, y), int(36 * (y / S) ** 2))
    dark = Image.new("RGBA", (S, S), RED_DARK)
    img = Image.composite(dark, img, grad.resize((S, S)))
    d = ImageDraw.Draw(img)

    # 抽字
    f = font(int(S * (0.50 if maskable else 0.56)))
    bbox = d.textbbox((0, 0), "抽", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (S - tw) / 2 - bbox[0]
    ty = (S - th) / 2 - bbox[1] - (S * 0.015 if not maskable else 0)
    # 轻微投影
    d.text((tx + S * 0.008, ty + S * 0.01), "抽", font=f, fill=(110, 25, 15, 110))
    d.text((tx, ty), "抽", font=f, fill=CREAM)

    # 底部细线，像档案标签
    if not maskable:
        lw = int(S * 0.30)
        y = int(S * 0.845)
        d.line([(S - lw) / 2, y, (S + lw) / 2, y], fill=(255, 246, 237, 150), width=max(2, S // 220))

    return img.resize((size, size), Image.LANCZOS)

make(192).save(os.path.join(HERE, "icon-192.png"))
make(512).save(os.path.join(HERE, "icon-512.png"))
make(512, maskable=True).save(os.path.join(HERE, "icon-maskable-512.png"))
make(180).save(os.path.join(HERE, "apple-touch-icon.png"))
print("icons generated")
