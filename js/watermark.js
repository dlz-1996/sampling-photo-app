/* 图片处理：缩放、烧水印、缩略图、哈希 */

import { fmtTime, sha256Blob } from './util.js';

async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片格式无法解码，请换一张 JPG/PNG'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

async function toBitmap(source) {
  if (source instanceof Blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(source, { imageOrientation: 'from-image' });
      } catch {
        try { return await createImageBitmap(source); } catch {}
      }
    }
    return await blobToImage(source);
  }
  if (source instanceof ImageBitmap) return source;
  // HTMLCanvasElement / HTMLVideoElement / HTMLImageElement
  return source;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function watermarkLines({ batchNo, categoryShort, takenAt, gps, showTime, showGps, sourceKind }) {
  const lines = [];
  const head = [batchNo, categoryShort].filter(Boolean).join(' · ');
  lines.push(head || '抽样取证');
  if (showTime) {
    const t = fmtTime(takenAt);
    lines.push(sourceKind === 'album' ? `${t}（相册导入）` : t);
  }
  if (showGps) {
    if (gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
      const acc = Number.isFinite(gps.accuracy) ? ` ±${Math.round(gps.accuracy)}m` : '';
      lines.push(`GPS ${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}${acc}`);
    } else {
      lines.push('GPS 未获取');
    }
  }
  return lines;
}

function drawWatermark(ctx, W, H, lines) {
  if (!lines.length) return;
  let font = Math.max(18, Math.min(46, Math.round(W * 0.026)));
  const family = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
  const setFont = () => { ctx.font = `600 ${font}px ${family}`; };

  setFont();
  const maxWidth = () => Math.max(...lines.map(t => ctx.measureText(t).width));
  // 长批次号自动缩字号，保证不超出画面 90%
  let guard = 0;
  while (maxWidth() > W * 0.86 && font > 12 && guard++ < 20) {
    font -= 1;
    setFont();
  }

  const pad = Math.round(font * 0.62);
  const lineH = Math.round(font * 1.42);
  const boxW = Math.ceil(maxWidth() + pad * 2 + font * 0.5);
  const boxH = lines.length * lineH + pad * 1.25;
  const x = Math.round(W * 0.024);
  const y = Math.round(H - boxH - H * 0.024);
  const radius = Math.round(font * 0.32);

  ctx.save();
  ctx.fillStyle = 'rgba(10, 12, 12, 0.58)';
  roundRect(ctx, x, y, boxW, boxH, radius);
  ctx.fill();

  // 左侧印章红色竖条
  ctx.fillStyle = 'rgba(184, 62, 45, 0.95)';
  roundRect(ctx, x, y + 1, Math.max(3, Math.round(font * 0.09)), boxH - 2, 2);
  ctx.fill();

  ctx.fillStyle = '#fdfaf3';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = Math.max(1, font * 0.06);
  ctx.shadowOffsetY = 1;
  setFont();
  const textX = x + pad + font * 0.32;
  lines.forEach((line, i) => {
    const cy = y + pad * 0.62 + lineH * (i + 0.5);
    ctx.fillText(line, textX, cy);
  });
  ctx.restore();
}

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片编码失败')), 'image/jpeg', quality);
  });
}

/**
 * 生成用于归档的照片（已烧水印）与缩略图，并计算哈希。
 * @returns {Promise<{blob:Blob, thumb:Blob, width:number, height:number, size:number, thumbSize:number, sha256:string}>}
 */
export async function processPhoto(source, {
  batchNo = '',
  categoryShort = '',
  takenAt = Date.now(),
  gps = null,
  sourceKind = 'camera',
  maxEdge = 1600,
  quality = 0.85,
  showTime = true,
  showGps = true,
} = {}) {
  const bmp = await toBitmap(source);
  const sw = bmp.width || bmp.videoWidth || bmp.naturalWidth;
  const sh = bmp.height || bmp.videoHeight || bmp.naturalHeight;
  if (!sw || !sh) throw new Error('无法读取图片尺寸');

  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * scale));
  const H = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bmp, 0, 0, W, H);

  drawWatermark(ctx, W, H, watermarkLines({
    batchNo, categoryShort, takenAt, gps, showTime, showGps, sourceKind,
  }));

  const blob = await canvasToBlob(canvas, quality);

  // 缩略图（长边 360）
  const tScale = Math.min(1, 360 / Math.max(W, H));
  const tw = Math.max(1, Math.round(W * tScale));
  const th = Math.max(1, Math.round(H * tScale));
  const tc = document.createElement('canvas');
  tc.width = tw;
  tc.height = th;
  tc.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, tw, th);
  const thumb = await canvasToBlob(tc, 0.72);

  if (bmp && typeof bmp.close === 'function') bmp.close();

  const sha256 = await sha256Blob(blob);
  return { blob, thumb, width: W, height: H, size: blob.size, thumbSize: thumb.size, sha256 };
}

/** 把视频当前帧画到 canvas（全画幅，不裁切） */
export function videoFrame(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('相机画面尚未就绪');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { alpha: false }).drawImage(video, 0, 0, w, h);
  return c;
}
