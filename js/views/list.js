/* 批次列表页 */

import { listBatches, countPhotos, putBatch, getSettings } from '../db.js';
import { CATEGORIES, requiredOf, statusOf } from '../categories.js';
import { icon, escapeHtml, toast, openSheet, confirmDialog } from '../util.js';
import { openBatchForm } from '../forms.js';
import { navigate } from '../router.js';
import { importBatchCSV } from '../importer.js';

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '进行中' },
  { key: 'submitted', label: '已提交' },
];

export async function render(root) {
  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="seal" aria-hidden="true">抽</div>
        <div class="grow">
          <h1>抽样拍照</h1>
          <div class="sub">取证 · 归档</div>
        </div>
        <button class="icon-btn" id="btn-import" aria-label="导入批次" title="导入批次">${icon('upload', 21)}</button>
        <button class="icon-btn" id="btn-settings" aria-label="设置" title="设置">${icon('settings', 21)}</button>
      </header>
      <div class="screen-body">
        <div class="stack" style="gap:12px">
          <div class="searchbar">
            ${icon('search', 19)}
            <input id="q" type="search" placeholder="搜索批次号 / 单位 / 产品" autocomplete="off">
          </div>
          <div class="segmented" id="filters">
            ${FILTERS.map((f, i) => `<button data-filter="${f.key}" class="${i === 0 ? 'active' : ''}">${f.label}</button>`).join('')}
          </div>
        </div>
        <div id="list" style="margin-top:12px"></div>
        <div class="footnote" style="margin-top:18px;text-align:center">
          照片保存在本机浏览器，请定期导出备份。
        </div>
      </div>
    </div>
    <button class="fab" id="btn-new" aria-label="新建批次">${icon('plus', 28)}</button>
    <input type="file" id="file-import" accept=".csv,text/csv,text/plain" hidden>
  `;

  const listEl = root.querySelector('#list');
  const qEl = root.querySelector('#q');
  const fileEl = root.querySelector('#file-import');
  const state = { q: '', filter: 'all', rows: [] };
  let alive = true;

  async function load() {
    const batches = await listBatches();
    const rows = [];
    for (const b of batches) {
      const c = await countPhotos(b.id);
      rows.push({ b, ...c });
    }
    if (!alive) return;
    state.rows = rows;
    paint();
  }

  function missingOf(row) {
    return CATEGORIES.filter(c => (row.counts[c.key] || 0) < requiredOf(row.b, c.key));
  }

  function cardHTML(row) {
    const { b, counts, total } = row;
    const st = statusOf(b, counts);
    const missing = missingOf(row);
    const doneCats = CATEGORIES.length - missing.length;
    const name = b.sampledUnit || b.producer || '未填写被抽样单位';
    const sub = [b.product || b.sampleName, b.specModel].filter(Boolean).join(' · ') || '未填写产品';
    const dots = CATEGORIES.map(c => {
      const n = counts[c.key] || 0;
      const cls = n >= requiredOf(b, c.key) ? 'on' : (n > 0 ? 'miss' : '');
      return `<i class="dot ${cls}" title="${escapeHtml(c.short)} ${n}/${requiredOf(b, c.key)}"></i>`;
    }).join('');
    const missText = missing.length
      ? `<span class="miss-text">缺 ${missing.length} 类：${missing.slice(0, 2).map(c => c.short).join('、')}${missing.length > 2 ? '…' : ''}</span>`
      : `<span style="color:var(--ok)">六类齐全 · ${doneCats}/6</span>`;
    return `<button class="card batch-card" data-id="${b.id}">
      <div class="b-top">
        <span class="pill ${st.cls}">${st.text}</span>
        <span class="b-no grow">${escapeHtml(b.batchNo)}</span>
        <span class="mono tiny">${total} 张</span>
      </div>
      <div class="b-name">${escapeHtml(name)}</div>
      <div class="b-sub ellipsis">${escapeHtml(sub)}</div>
      <div class="b-foot">
        <div class="dots">${dots}</div>
        <span class="grow ellipsis small">${missText}</span>
        <span class="mono" style="font-size:11px">${escapeHtml(b.inspector || '')}</span>
      </div>
    </button>`;
  }

  function paint() {
    const q = state.q.trim().toLowerCase();
    let rows = state.rows.filter(({ b }) => {
      if (state.filter === 'open' && b.status === 'submitted') return false;
      if (state.filter === 'submitted' && b.status !== 'submitted') return false;
      if (!q) return true;
      return [b.batchNo, b.sampledUnit, b.producer, b.product, b.sampleName, b.specModel, b.inspector]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    if (!state.rows.length) {
      listEl.innerHTML = `<div class="empty card" style="margin-top:8px">
        <div class="e-icon">${icon('camera', 30)}</div>
        <h3>还没有抽样批次</h3>
        <p>从 Excel 生成 CSV 导入，或手动新建一个批次。</p>
        <div class="row" style="justify-content:center;margin-top:16px;gap:8px">
          <button class="btn primary sm" data-act="import">${icon('upload', 16)} 导入批次</button>
          <button class="btn ghost sm" data-act="new">${icon('plus', 16)} 新建</button>
        </div>
        <p style="margin-top:16px"><button class="link" data-act="help">怎么导入？</button></p>
      </div>`;
      return;
    }

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty" style="padding:36px 10px">
        <p>没有匹配的批次</p>
      </div>`;
      return;
    }

    listEl.innerHTML = rows.map(cardHTML).join('');
  }

  function showHelp() {
    openSheet({
      title: '如何批量导入批次',
      body: `
        <ol style="padding-left:20px;font-size:13.5px;line-height:1.9;color:var(--ink-2)">
          <li>在电脑项目目录执行 <span class="mono">python tools\\make_photo_tasks.py</span></li>
          <li>生成 <span class="mono">输出\\照片任务导入.csv</span></li>
          <li>把 CSV 发到手机（微信/文件传输）</li>
          <li>回到本页点右上角上传按钮，选择该 CSV</li>
        </ol>
        <div class="banner info" style="margin-top:12px">
          ${icon('info', 17)}
          <div>也支持直接用 Excel「另存为 CSV UTF-8」的文件；重复批次号会自动跳过。</div>
        </div>
        <div class="footnote">CSV 表头可用：批次号、市场监督管理局、生产公司、产品、抽样地点、样品名称、规格型号、报告编号、抽样人。</div>
      `,
      foot: `<button class="btn ghost" data-close>知道了</button>`,
    });
  }

  /* ---------- 事件 ---------- */

  qEl.addEventListener('input', () => { state.q = qEl.value; paint(); });

  root.querySelector('#filters').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    root.querySelectorAll('#filters button').forEach(b => b.classList.toggle('active', b === btn));
    paint();
  });

  listEl.addEventListener('click', async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'import') { fileEl.click(); return; }
    if (act === 'new') { if (await openBatchForm()) load(); return; }
    if (act === 'help') { showHelp(); return; }
    const card = e.target.closest('[data-id]');
    if (card) navigate(`/batch/${card.dataset.id}`);
  });

  root.querySelector('#btn-settings').onclick = () => navigate('/settings');
  root.querySelector('#btn-import').onclick = () => fileEl.click();
  root.querySelector('#btn-new').onclick = async () => { if (await openBatchForm()) load(); };

  fileEl.addEventListener('change', async () => {
    const file = fileEl.files?.[0];
    fileEl.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('CSV 文件过大'); return; }
    try {
      const settings = await getSettings();
      const res = await importBatchCSV(file, settings);
      await load();
      if (res.added || res.skipped.length) {
        const skippedText = res.skipped.slice(0, 6).map(s => `<li>${escapeHtml(s)}</li>`).join('');
        openSheet({
          title: '导入完成',
          body: `<div class="export-summary card">
              <div class="row"><span class="big-n">${res.added}</span><span class="muted">个批次已导入</span></div>
              <div class="small muted" style="margin-top:4px">跳过 ${res.skipped.length} 行</div>
            </div>
            ${res.skipped.length ? `<ul class="small" style="padding-left:18px;color:var(--muted);line-height:1.8;margin-top:12px">${skippedText}${res.skipped.length > 6 ? '<li>…</li>' : ''}</ul>` : ''}`,
          foot: `<button class="btn primary" data-close>好</button>`,
        });
      }
    } catch (err) {
      console.error(err);
      toast('导入失败：' + (err.message || err));
    }
  });

  // 首次渲染
  await load();

  return () => { alive = false; };
}
