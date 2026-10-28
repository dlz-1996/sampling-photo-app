/* 导出页：选批次 → ZIP / 打印汇总 */

import { listBatches, countPhotos, getSettings, saveSettings } from '../db.js';
import { CATEGORIES, requiredOf } from '../categories.js';
import { icon, escapeHtml, toast, formatBytes, shareFile } from '../util.js';
import { createExportZip, printBatches } from '../exporter.js';
import { navigate, back } from '../router.js';

export async function render(root, { id }) {
  const batches = await listBatches();
  const settings = await getSettings();
  const rows = [];
  for (const b of batches) {
    const c = await countPhotos(b.id);
    rows.push({ b, ...c });
  }
  const selected = new Set(id && rows.some(r => r.b.id === id) ? [id] : rows.map(r => r.b.id));

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn plain" id="e-back" aria-label="返回">${icon('back', 22)}</button>
        <div class="grow"><h1 style="font-size:17px">导出照片</h1><div class="sub">ZIP · 汇总 · 备份</div></div>
      </header>
      <div class="screen-body" id="e-body"></div>
    </div>
  `;

  const body = root.querySelector('#e-body');

  function selectedRows() {
    return rows.filter(r => selected.has(r.b.id));
  }

  function totalPhotos() {
    return selectedRows().reduce((a, r) => a + r.total, 0);
  }

  function paint() {
    const sel = selectedRows();
    const nPhotos = totalPhotos();
    const all = sel.length === rows.length && rows.length > 0;

    body.innerHTML = rows.length ? `
      <div class="row" style="margin-bottom:10px">
        <span class="section-title" style="margin:0;flex:1">选择批次 <span class="line"></span></span>
        <button class="btn quiet sm" id="e-all">${all ? '全不选' : '全选'}</button>
      </div>
      <div class="card" id="e-list">
        ${rows.map(r => {
          const on = selected.has(r.b.id);
          const missing = CATEGORIES.filter(c => (r.counts[c.key] || 0) < requiredOf(r.b, c.key));
          const name = r.b.sampledUnit || r.b.producer || '未填写单位';
          return `<div class="batch-pick" data-id="${r.b.id}">
            <div class="check ${on ? 'on' : ''}">${icon('check', 16)}</div>
            <div class="bp-main">
              <div class="bp-no">${escapeHtml(r.b.batchNo)}</div>
              <div class="bp-name ellipsis">${escapeHtml(name)}</div>
              <div class="tiny ${missing.length ? 'miss-text' : 'muted'}" style="margin-top:2px">
                ${r.total} 张${missing.length ? ` · 缺 ${missing.map(c => escapeHtml(c.short)).join('、')}` : ' · 六类齐全'}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="card export-summary" style="margin-top:14px">
        <div class="row">
          <div class="grow">
            <div class="small muted">已选 ${sel.length} 个批次</div>
            <div class="row" style="align-items:baseline;gap:6px">
              <span class="big-n">${nPhotos}</span><span class="muted small">张照片</span>
            </div>
          </div>
          ${icon('zip', 30)}
        </div>
        <div class="small muted" style="margin-top:6px">ZIP 内含批次文件夹、照片清单 CSV、批次信息与可打印的照片汇总 HTML。</div>
      </div>

      <div class="stack" style="margin-top:14px;gap:10px">
        <button class="btn seal block" id="e-zip" ${!sel.length || !nPhotos ? 'disabled' : ''}>${icon('download', 19)} 生成 ZIP 并分享/保存</button>
        <button class="btn ghost block" id="e-print" ${!sel.length || !nPhotos ? 'disabled' : ''}>${icon('print', 19)} 打印照片汇总 / 存为 PDF</button>
      </div>

      <div class="banner info" style="margin-top:14px">
        ${icon('info', 17)}
        <div>照片保留原始分辨率压缩版并已烧水印。ZIP 通过系统分享面板发出，可直接存到文件管理器或发给电脑。</div>
      </div>

      <div class="banner" style="margin-top:10px;background:#f3eee2;border-color:#e4d9c3;color:#6a5b3c">
        ${icon('folder', 17)}
        <div>电脑端归档：把 ZIP 放到项目目录，运行 <span class="mono">python tools\\photo_ingest.py 文件.zip</span>，自动解压到「照片归档」并核对六类齐全性和 SHA-256。</div>
      </div>

      <div class="footnote" style="text-align:center;margin-top:16px">
        当前每类最低 ${settings.required} 张，单类上限 10 张。
      </div>
    ` : `<div class="empty card">
        <div class="e-icon">${icon('camera', 30)}</div>
        <h3>还没有批次</h3>
        <p>先创建或导入批次，再来导出。</p>
      </div>`;

    if (!rows.length) return;

    body.querySelector('#e-all').onclick = () => {
      if (all) selected.clear();
      else rows.forEach(r => selected.add(r.b.id));
      paint();
    };
    body.querySelectorAll('.batch-pick').forEach(el => {
      el.onclick = () => {
        const bid = el.dataset.id;
        if (selected.has(bid)) selected.delete(bid); else selected.add(bid);
        paint();
      };
    });
    body.querySelector('#e-zip')?.addEventListener('click', doZip);
    body.querySelector('#e-print')?.addEventListener('click', doPrint);
  }

  function busyMask(text) {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.style.display = 'grid';
    mask.style.placeItems = 'center';
    mask.innerHTML = `<div class="card" style="padding:18px 24px;text-align:center;max-width:280px">
      <div class="skeleton" style="width:42px;height:42px;border-radius:50%;margin:0 auto 10px"></div>
      <div class="small">${escapeHtml(text)}</div>
    </div>`;
    document.body.appendChild(mask);
    return () => mask.remove();
  }

  async function doZip() {
    const ids = [...selected];
    if (!ids.length) return;
    const done = busyMask('正在打包照片…');
    await new Promise(r => setTimeout(r, 60));
    try {
      const res = await createExportZip(ids);
      done();
      const how = await shareFile(res.blob, res.filename, '抽样照片');
      await saveSettings({ lastExportAt: Date.now() });
      if (how === 'downloaded') toast(`已保存：${res.filename}（${formatBytes(res.blob.size)}）`, 3500);
      else if (how === 'shared') toast('已发送');
    } catch (e) {
      done();
      console.error(e);
      toast('生成失败：' + (e.message || e), 3500);
    }
  }

  async function doPrint() {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const r = await printBatches(ids);
      if (!r.ok) toast('打印窗口被拦截，请允许弹出窗口后重试', 3200);
    } catch (e) {
      console.error(e);
      toast('生成失败：' + (e.message || e), 3200);
    }
  }

  paint();
  root.querySelector('#e-back').onclick = () => back('/');
  return () => {};
}
