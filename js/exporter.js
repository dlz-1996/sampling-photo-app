/* 导出：ZIP、CSV、照片汇总 HTML、全量备份/恢复 */

import { zipSync, unzipSync, strToU8 } from './vendor/fflate.js';
import { listBatches, getBatch, listPhotos, allPhotos, getSettings, saveSettings, putBatch, addPhoto } from './db.js';
import { CATEGORIES, cat, folderName } from './categories.js';
import { sanitizeFilename, fmtTime, fmtDate, fmtDateTimeFile, toCSV, pad, escapeHtml } from './util.js';

const APP_TAG = 'sampling-photo-app';
const BACKUP_VERSION = 1;

function sourceText(s) {
  return s === 'album' ? '相册导入' : (s === 'camera' ? '相机拍摄' : '系统相机');
}

function catIndex(key) {
  return CATEGORIES.findIndex(c => c.key === key);
}

function sortedPhotos(photos) {
  return [...photos].sort((a, b) => {
    const ca = catIndex(a.category), cb = catIndex(b.category);
    if (ca !== cb) return ca - cb;
    if ((a.takenAt || 0) !== (b.takenAt || 0)) return (a.takenAt || 0) - (b.takenAt || 0);
    return (a.seq || 0) - (b.seq || 0);
  });
}

/** 生成批次信息 CSV 文本 */
function batchInfoCSV(batch, photos, exportedAt) {
  const rows = [
    ['字段', '内容'],
    ['批次号', batch.batchNo],
    ['市场监督管理局', batch.bureau || ''],
    ['生产公司', batch.producer || ''],
    ['被抽样单位', batch.sampledUnit || ''],
    ['产品大类', batch.product || ''],
    ['样品名称', batch.sampleName || ''],
    ['规格型号', batch.specModel || ''],
    ['报告编号', batch.reportNo || ''],
    ['抽样人', batch.inspector || ''],
    ['批次状态', batch.status === 'submitted' ? '已提交' : '进行中'],
    ['照片总数', photos.length],
    ['创建时间', fmtTime(batch.createdAt || 0)],
    ['提交时间', batch.submittedAt ? fmtTime(batch.submittedAt) : ''],
    ['导出时间', fmtTime(exportedAt)],
    ['备注', (batch.note || '').replace(/\r?\n/g, ' ')],
  ];
  return toCSV(rows);
}

/** 生成照片清单 CSV 文本，并返回带文件名的照片列表 */
function photoCSV(batch, photos, prefixPath) {
  const rows = [
    ['序号', '照片类别', '类别内序号', '相对路径', '拍摄时间', '来源', '纬度', '经度', '定位精度(m)', '像素宽', '像素高', '大小(KB)', 'SHA256', '备注'],
  ];
  const out = [];
  const perCat = {};
  sortedPhotos(photos).forEach((p, i) => {
    perCat[p.category] = (perCat[p.category] || 0) + 1;
    const seq = perCat[p.category];
    const name = `${pad(seq, 3)}_${fmtDateTimeFile(p.takenAt)}.jpg`;
    const rel = `${folderName(p.category)}/${name}`;
    rows.push([
      i + 1, cat(p.category).name, seq, rel, fmtTime(p.takenAt), sourceText(p.source),
      p.lat != null ? Number(p.lat).toFixed(6) : '',
      p.lng != null ? Number(p.lng).toFixed(6) : '',
      p.accuracy != null ? Math.round(p.accuracy) : '',
      p.width || '', p.height || '', Math.round((p.size || 0) / 1024), p.sha256 || '', p.note || '',
    ]);
    out.push({ photo: p, path: `${prefixPath}/${rel}` });
  });
  return { csv: toCSV(rows), files: out };
}

/** 照片汇总 HTML（供 ZIP 内打印，或手机新窗口打印/存 PDF） */
export function summaryHtml(batch, photos, { urlFor, exportedAt = Date.now() } = {}) {
  const total = photos.length;
  const ordered = sortedPhotos(photos);
  const catTotal = {};
  ordered.forEach(p => { catTotal[p.category] = (catTotal[p.category] || 0) + 1; });
  const seen = {};
  const figuresHtml = ordered.map(p => {
    seen[p.category] = (seen[p.category] || 0) + 1;
    const c = cat(p.category);
    const idx = catTotal[p.category] > 1 ? ` ${seen[p.category]}/${catTotal[p.category]}` : '';
    const gps = p.lat != null
      ? `GPS ${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}${p.accuracy ? ` ±${Math.round(p.accuracy)}m` : ''}`
      : 'GPS 未记录';
    return `<figure>
      <img src="${escapeHtml(urlFor(p))}" alt="${escapeHtml(c.short)} ${seen[p.category]}">
      <figcaption>
        <div class="cap"><b>${c.no} ${escapeHtml(c.short)}${idx}</b><span>${fmtTime(p.takenAt)}</span></div>
        <div class="gps">${gps}</div>
        ${p.note ? `<div class="note">${escapeHtml(p.note)}</div>` : ''}
      </figcaption>
    </figure>`;
  }).join('');

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>照片汇总 · ${escapeHtml(batch.batchNo)}</title>
<style>
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px 16px 40px; font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif; color: #1b1d1c; background: #fff; font-size: 12px; }
  .head { border-bottom: 2px solid #b23a2b; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 18px; margin: 0 0 6px; letter-spacing: .04em; }
  .no { font-family: Consolas, monospace; font-size: 12px; color: #444; }
  table.meta { border-collapse: collapse; width: 100%; margin: 8px 0 12px; font-size: 11px; }
  table.meta td { border: 1px solid #ddd; padding: 4px 6px; vertical-align: top; }
  table.meta td.k { background: #f6f3ec; color: #666; width: 76px; white-space: nowrap; }
  .topbar { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .print-btn { padding: 7px 14px; border: 0; border-radius: 6px; background: #22384c; color: #fff; font-size: 12px; cursor: pointer; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin-top: 10px; }
  figure { margin: 0; break-inside: avoid; page-break-inside: avoid; }
  figure img { width: 100%; height: 72mm; object-fit: contain; background: #f2f0ea; border: 1px solid #e2ddd2; }
  figcaption { font-size: 9.5px; line-height: 1.55; color: #555; padding-top: 3px; }
  figcaption .cap { display: flex; justify-content: space-between; gap: 8px; }
  figcaption b { color: #b23a2b; font-size: 10px; }
  figcaption .gps { font-family: Consolas, monospace; font-size: 8.5px; color: #777; }
  figcaption .note { color: #333; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px dashed #ccc; font-size: 9px; color: #888; }
  @media print {
    body { padding: 0; }
    .print-btn { display: none; }
  }
</style></head>
<body>
  <div class="topbar">
    <div>
      <h1>抽样取证照片汇总</h1>
      <div class="no">${escapeHtml(batch.batchNo)}</div>
    </div>
    <button class="print-btn" onclick="window.print()">打印 / 存为 PDF</button>
  </div>
  <table class="meta">
    <tr><td class="k">被抽样单位</td><td>${escapeHtml(batch.sampledUnit || '')}</td><td class="k">生产公司</td><td>${escapeHtml(batch.producer || '')}</td></tr>
    <tr><td class="k">产品 / 样品</td><td>${escapeHtml([batch.product, batch.sampleName].filter(Boolean).join(' / '))}</td><td class="k">规格型号</td><td>${escapeHtml(batch.specModel || '')}</td></tr>
    <tr><td class="k">抽样人</td><td>${escapeHtml(batch.inspector || '')}</td><td class="k">报告编号</td><td>${escapeHtml(batch.reportNo || '')}</td></tr>
    <tr><td class="k">照片总数</td><td>${total} 张</td><td class="k">导出时间</td><td>${fmtTime(exportedAt)}</td></tr>
  </table>
  <div class="grid">${figuresHtml || '<p>本批次暂无照片。</p>'}</div>
  <div class="foot">
    照片已烧入批次号、类别、拍摄时间与 GPS 经纬度水印；每张照片的 SHA-256 校验值见同目录《照片清单.csv》。
    本页由「抽样拍照」App 生成。
  </div>
</body></html>`;
}

const EXPORT_README = `抽样照片导出说明
================

目录结构：
  批次号/
    01_企业抽样（营业执照）/
    02_购物票据（发票）/
    03_现场取样（样品照片）/
    04_现场封样（封样）/
    05_抽样单和签字/
    06_样品运输/
    照片清单.csv        每张照片的时间、GPS、SHA-256 校验值
    批次信息.csv        本批次基础信息
    照片汇总.html       在电脑上双击打开，可打印或另存为 PDF

归档方法（推荐）：
  1. 把 ZIP 文件放到项目目录下（任意位置）
  2. 在项目目录打开 PowerShell，运行：
       python tools\\photo_ingest.py 你的文件.zip
  3. 照片会解压到 照片归档/批次号/ 下，并自动核对六类照片是否齐全、哈希是否一致
  4. 也可直接用 Windows 解压到 照片归档/ 下，再运行：
       python tools\\photo_ingest.py --check

注意：
  - 照片水印中的时间与 GPS 为拍摄时的记录，水印已烧入像素
  - 修改照片会导致 SHA-256 校验不通过（照片清单.csv 中有原始值）
  - 本压缩包由手机本地生成，未经过任何服务器
`;

/** 构造导出 ZIP（异步读取 Blob） */
export async function createExportZip(batchIds) {
  const exportedAt = Date.now();
  const entries = {};
  const names = [];
  const usedFolders = new Set();
  let photoCount = 0;

  for (const id of batchIds) {
    const batch = await getBatch(id);
    if (!batch) continue;
    const photos = await listPhotos(id);
    let folder = sanitizeFilename(batch.batchNo);
    let n = 2;
    while (usedFolders.has(folder)) folder = `${sanitizeFilename(batch.batchNo)}(${n++})`;
    usedFolders.add(folder);
    names.push(folder);

    const perCat = {};
    for (const p of sortedPhotos(photos)) {
      perCat[p.category] = (perCat[p.category] || 0) + 1;
      const seq = perCat[p.category];
      const name = `${pad(seq, 3)}_${fmtDateTimeFile(p.takenAt)}.jpg`;
      const path = `${folder}/${folderName(p.category)}/${name}`;
      entries[path] = new Uint8Array(await p.blob.arrayBuffer());
      photoCount++;
    }

    entries[`${folder}/照片清单.csv`] = strToU8(photoCSV(batch, photos, folder).csv);
    entries[`${folder}/批次信息.csv`] = strToU8(batchInfoCSV(batch, photos, exportedAt));
    entries[`${folder}/照片汇总.html`] = strToU8(summaryHtml(batch, photos, {
      urlFor: p => {
        const list = sortedPhotos(photos);
        const per = {};
        let rel = '';
        for (const q of list) {
          per[q.category] = (per[q.category] || 0) + 1;
          if (q.id === p.id) {
            rel = `${folderName(q.category)}/${pad(per[q.category], 3)}_${fmtDateTimeFile(q.takenAt)}.jpg`;
            break;
          }
        }
        return rel;
      },
      exportedAt,
    }));
  }

  entries['导出说明.txt'] = strToU8(EXPORT_README);

  const today = fmtDate(exportedAt);
  const filename = batchIds.length === 1
    ? `${names[0] || '抽样照片'}_抽样照片_${today}.zip`
    : `抽样照片_${today}_${names.length}批.zip`;

  const bytes = zipSync(entries, { level: 0 });
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    filename,
    photoCount,
    batchCount: names.length,
  };
}

/** 手机端打印照片汇总（新窗口 → 打印/另存 PDF） */
export async function printBatches(batchIds) {
  const win = window.open('', '_blank');
  if (!win) return { ok: false, reason: 'blocked' };

  const urls = [];
  try {
    const sections = [];
    for (const id of batchIds) {
      const batch = await getBatch(id);
      if (!batch) continue;
      const photos = await listPhotos(id);
      sections.push(summaryHtml(batch, photos, {
        urlFor: p => {
          const u = URL.createObjectURL(p.blob);
          urls.push(u);
          return u;
        },
      }).replace(/^[\s\S]*?<body>|<\/body>[\s\S]*$/g, ''));
    }

    win.document.open();
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
      <title>照片汇总</title>
      <style>
        @page { size: A4; margin: 12mm 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 18px 16px 40px; font-family: "Microsoft YaHei","PingFang SC",sans-serif; color:#1b1d1c; font-size:12px; }
        .head { border-bottom:2px solid #b23a2b; padding-bottom:8px; margin-bottom:10px; }
        h1 { font-size:18px; margin:0 0 6px; }
        .no { font-family:Consolas,monospace; font-size:12px; color:#444; }
        table.meta { border-collapse:collapse; width:100%; margin:8px 0 12px; font-size:11px; }
        table.meta td { border:1px solid #ddd; padding:4px 6px; vertical-align:top; }
        table.meta td.k { background:#f6f3ec; color:#666; width:76px; white-space:nowrap; }
        .topbar { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
        .print-btn { padding:7px 14px; border:0; border-radius:6px; background:#22384c; color:#fff; font-size:12px; }
        .grid { display:grid; grid-template-columns:1fr 1fr; gap:5mm; margin-top:10px; }
        figure { margin:0; break-inside:avoid; page-break-inside:avoid; }
        figure img { width:100%; height:72mm; object-fit:contain; background:#f2f0ea; border:1px solid #e2ddd2; }
        figcaption { font-size:9.5px; line-height:1.55; color:#555; padding-top:3px; }
        figcaption .cap { display:flex; justify-content:space-between; gap:8px; }
        figcaption b { color:#b23a2b; font-size:10px; }
        figcaption .gps { font-family:Consolas,monospace; font-size:8.5px; color:#777; }
        figcaption .note { color:#333; }
        .foot { margin-top:14px; padding-top:6px; border-top:1px dashed #ccc; font-size:9px; color:#888; }
        @media print { body { padding:0; } .print-btn { display:none; } }
      </style></head><body>
      <div style="text-align:right;margin-bottom:6px"><button class="print-btn" onclick="window.print()">打印 / 存为 PDF</button></div>
      ${sections.join('<hr style="border:0;border-top:1px dashed #ccc;margin:18px 0">')}
      <p style="font-size:10px;color:#888">提示：若打印对话框未自动弹出，请点右上角按钮，选择「另存为 PDF」。</p>
      </body></html>`);
    win.document.close();

    const imgs = [...win.document.images];
    await Promise.all(imgs.map(img => img.decode ? img.decode().catch(() => {}) : Promise.resolve()));
    setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 350);
    win.addEventListener('beforeunload', () => urls.forEach(u => URL.revokeObjectURL(u)));
    return { ok: true };
  } catch (e) {
    urls.forEach(u => URL.revokeObjectURL(u));
    try { win.close(); } catch {}
    throw e;
  }
}

/* ---------------- 全量备份 / 恢复 ---------------- */

export async function createBackup() {
  const [batches, photos, settings] = await Promise.all([listBatches(), allPhotos(), getSettings()]);
  const entries = {};
  const metaPhotos = [];

  for (const p of photos) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const file = `photos/${p.batchId}/${p.id}.jpg`;
    entries[file] = bytes;
    const thumbFile = `thumbs/${p.id}.jpg`;
    if (p.thumb) entries[thumbFile] = new Uint8Array(await p.thumb.arrayBuffer());
    metaPhotos.push({
      id: p.id, batchId: p.batchId, category: p.category, seq: p.seq,
      width: p.width, height: p.height, size: p.size, thumbSize: p.thumbSize,
      sha256: p.sha256, takenAt: p.takenAt, source: p.source,
      lat: p.lat, lng: p.lng, accuracy: p.accuracy, note: p.note, createdAt: p.createdAt,
      file, thumbFile: p.thumb ? thumbFile : null,
    });
  }

  const data = {
    app: APP_TAG, version: BACKUP_VERSION, exportedAt: Date.now(),
    settings, batches, photos: metaPhotos,
  };
  entries['data.json'] = strToU8(JSON.stringify(data));

  const bytes = zipSync(entries, { level: 0 });
  const name = `抽样拍照备份_${fmtDateTimeFile(Date.now())}.zip`;
  return {
    blob: new Blob([bytes], { type: 'application/zip' }),
    filename: name,
    batches: batches.length,
    photos: photos.length,
    bytes: bytes.length,
  };
}

export async function restoreBackup(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(buf);
  const dataEntry = entries['data.json'];
  if (!dataEntry) throw new Error('不是有效的备份文件（缺少 data.json）');
  const data = JSON.parse(new TextDecoder().decode(dataEntry));
  if (data.app !== APP_TAG) throw new Error('备份文件类型不匹配');

  const existingBatches = await listBatches();
  const existingIds = new Set(existingBatches.map(b => b.id));
  const existingNos = new Set(existingBatches.map(b => b.batchNo));
  const existingPhotos = new Set((await allPhotos()).map(p => p.id));

  let restoredBatches = 0, restoredPhotos = 0, skippedBatches = 0, skippedPhotos = 0;

  for (const b of (data.batches || [])) {
    if (existingIds.has(b.id) || existingNos.has(b.batchNo)) { skippedBatches++; continue; }
    await putBatch({ ...b });
    existingIds.add(b.id);
    existingNos.add(b.batchNo);
    restoredBatches++;
  }

  for (const p of (data.photos || [])) {
    if (existingPhotos.has(p.id)) { skippedPhotos++; continue; }
    if (!entries[p.file]) { skippedPhotos++; continue; }
    const blob = new Blob([entries[p.file]], { type: 'image/jpeg' });
    const thumbBytes = p.thumbFile ? entries[p.thumbFile] : null;
    const thumb = thumbBytes ? new Blob([thumbBytes], { type: 'image/jpeg' }) : blob;
    await addPhoto({
      id: p.id, batchId: p.batchId, category: p.category, seq: p.seq,
      blob, thumb,
      width: p.width, height: p.height, size: p.size || blob.size, thumbSize: p.thumbSize || thumb.size,
      sha256: p.sha256, takenAt: p.takenAt, source: p.source,
      lat: p.lat ?? null, lng: p.lng ?? null, accuracy: p.accuracy ?? null,
      note: p.note || '', createdAt: p.createdAt || p.takenAt || Date.now(),
    });
    existingPhotos.add(p.id);
    restoredPhotos++;
  }

  if (data.settings) {
    try { await saveSettings(data.settings); } catch {}
  }

  return {
    restoredBatches, restoredPhotos, skippedBatches, skippedPhotos,
    totalBatches: (data.batches || []).length, totalPhotos: (data.photos || []).length,
  };
}
