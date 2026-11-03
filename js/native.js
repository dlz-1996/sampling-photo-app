/* Android 原生壳桥接层。
 * 在普通浏览器里 isNativeApp === false，所有导出函数都会安全回落或被调用方跳过，
 * 保证 PWA 版行为完全不变。 */

const bridge = typeof window !== 'undefined' ? window.NativeBridge : undefined;

export const isNativeApp = !!(bridge && typeof bridge.isNative === 'function' && bridge.isNative());

let seq = 0;

/** 一次原生调用：Java 完成后回调 window.__nativeResolve(id, ok, payload) */
function call(method, ...args) {
  return new Promise((resolve, reject) => {
    if (!isNativeApp) { reject(new Error('当前不是 App 环境')); return; }
    const id = String(++seq);
    window.__nativePending[id] = [resolve, reject];
    try {
      bridge[method](id, ...args);
    } catch (e) {
      delete window.__nativePending[id];
      reject(e);
    }
  });
}

/* ---------------- 基础转换 ---------------- */

export function dataUrlToBlob(url) {
  const i = url.indexOf(',');
  if (i < 0) throw new Error('图片数据无效');
  const mime = (url.slice(5, i).split(';')[0] || 'image/jpeg').trim();
  const bin = atob(url.slice(i + 1));
  const u8 = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
  return new Blob([u8], { type: mime });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error || new Error('读取图片失败'));
    fr.readAsDataURL(blob);
  });
}

/* 192KB，3 的整数倍，保证每个分片独立 base64 解码时不产生填充错位 */
const CHUNK = 192 * 1024;

function safeName(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
}

/* ---------------- 拍照 ---------------- */

/** 调系统相机拍一张，返回 Blob；用户取消返回 null */
export async function nativeTakePhoto() {
  const dataUrl = await call('takePhoto');
  if (!dataUrl) return null;
  return dataUrlToBlob(dataUrl);
}

/* ---------------- 定位 ---------------- */

/** 取一次定位；失败抛错，err.name 为 denied / unavailable */
export async function nativeLocate(timeoutMs = 8000) {
  let r = await call('locate', String(timeoutMs));
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { r = null; }
  }
  if (!r || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) {
    const e = new Error('未获取到定位');
    e.name = 'unavailable';
    throw e;
  }
  return { lat: r.lat, lng: r.lng, accuracy: r.accuracy, at: Date.now() };
}

/* ---------------- 相册 ---------------- */

/** 另存一份到系统相册 Pictures/抽样拍照/{subDir}/{name} */
export async function saveToGallery(blob, subDir, name) {
  if (!isNativeApp) return null;
  const b64 = await blobToBase64(blob);
  return call('saveImage', b64, subDir || '', safeName(name));
}

/* ---------------- 文件（分享 / 打印 / 保存） ---------------- */

async function writeNativeFile(blob, filename) {
  const path = bridge.beginFile(safeName(filename));
  if (!path || path === 'null') throw new Error('无法创建临时文件');
  for (let off = 0; off < blob.size; off += CHUNK) {
    const part = await blobToBase64(blob.slice(off, off + CHUNK));
    bridge.appendChunk(path, part);
  }
  const size = bridge.closeFile(path);
  if (!size) throw new Error('写入临时文件失败');
  return path;
}

async function writeNativeText(text, filename) {
  return writeNativeFile(new Blob([text], { type: 'text/html;charset=utf-8' }), filename);
}

/** 打开系统分享面板（可直接发微信、存到文件管理器） */
export async function nativeShareBlob(blob, filename, mime = 'application/octet-stream', title = '') {
  const path = await writeNativeFile(blob, filename);
  await call('shareFile', path, mime || 'application/octet-stream', title || filename);
  return 'shared';
}

/** 调系统打印（可另存为 PDF） */
export async function nativePrintHtml(html, jobName = '照片汇总') {
  const path = await writeNativeText(html, jobName + '.html');
  await call('printFile', path, jobName);
  return { ok: true };
}

/* ---------------- 杂项 ---------------- */

export function nativeToast(msg) {
  if (!isNativeApp) return;
  try { bridge.toast(String(msg)); } catch {}
}

export function nativeVibrate(ms = 22) {
  if (!isNativeApp) return;
  try { bridge.vibrate(ms); } catch {}
}

export function nativeInfo() {
  if (!isNativeApp) return null;
  try { return JSON.parse(bridge.info()); } catch { return null; }
}
