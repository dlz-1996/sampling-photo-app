/* 批次详情页：拍照任务清单 */

import { getBatch, listPhotos, putBatch, deleteBatch } from '../db.js';
import { CATEGORIES, cat, requiredOf, statusOf, MAX_PER_CATEGORY } from '../categories.js';
import { icon, escapeHtml, toast, openSheet, confirmDialog, fmtRelative, formatBytes, createUrlPool } from '../util.js';
import { openBatchForm, openInspectorSheet, openNoteSheet } from '../forms.js';
import { navigate, back } from '../router.js';

export async function render(root, { id }) {
  const pool = createUrlPool();
  let batch = await getBatch(id);
  let photos = [];
  let alive = true;

  if (!batch) {
    toast('批次不存在');
    navigate('/', { replace: true });
    return () => pool.revokeAll();
  }

  root.innerHTML = `
    <div class="screen has-bottombar">
      <header class="topbar">
        <button class="icon-btn plain" id="b-back" aria-label="返回">${icon('back', 22)}</button>
        <div class="grow">
          <h1 style="font-size:17px">批次详情</h1>
          <div class="sub">拍照任务清单</div>
        </div>
        <button class="icon-btn plain" id="b-menu" aria-label="更多">${icon('more', 22)}</button>
      </header>
      <div class="screen-body" id="b-content"></div>
      <div class="bottombar" id="b-bar"></div>
    </div>
  `;

  const content = root.querySelector('#b-content');
  const bar = root.querySelector('#b-bar');

  function counts() {
    const c = {};
    for (const p of photos) c[p.category] = (c[p.category] || 0) + 1;
    return c;
  }

  async function load() {
    batch = await getBatch(id);
    photos = await listPhotos(id);
    if (!alive) return;
    paint();
  }

  function infoRows() {
    const rows = [
      ['抽样人', batch.inspector, 'inspector'],
      ['被抽样单位', batch.sampledUnit, ''],
      ['生产公司', batch.producer, ''],
      ['产品', batch.product, ''],
      ['样品', batch.sampleName, ''],
      ['规格型号', batch.specModel, ''],
      ['报告编号', batch.reportNo, ''],
      ['市场监管局', batch.bureau, ''],
    ].filter(([, v]) => v);
    return rows.map(([k, v, act]) => `<div class="k">${k}</div>
      <div class="v ${k === '抽样人' ? 'strong' : ''}">${
        act === 'inspector'
          ? `<button class="link" data-edit-inspector style="padding:0;text-align:left">${escapeHtml(v)}</button>`
          : escapeHtml(v)
      }</div>`).join('');
  }

  function categoryRows(c) {
    return CATEGORIES.map(k => {
      const n = c[k.key] || 0;
      const req = requiredOf(batch, k.key);
      const ok = n >= req;
      const cls = ok ? 'ok' : (n > 0 ? 'miss' : '');
      const list = photos.filter(p => p.category === k.key).slice(0, 3);
      const thumbs = list.map(p =>
        `<img data-photo="${p.id}" src="${pool.get(p.thumb)}" alt="${escapeHtml(k.short)} ${p.seq}">`
      ).join('');
      return `<div class="cat-row" data-cat="${k.key}" role="button" tabindex="0">
        <div class="cat-icon ${cls}">${icon(k.icon, 21)}</div>
        <div class="grow">
          <div class="c-name">${escapeHtml(k.name)}</div>
          ${thumbs ? `<div class="cat-thumbs">${thumbs}</div>` : `<div class="c-desc">${escapeHtml(k.desc)}</div>`}
        </div>
        <div style="text-align:right">
          <div class="c-count ${cls}">${n}/${req}</div>
          <div class="tiny muted">最多 ${MAX_PER_CATEGORY}</div>
        </div>
        ${icon('chevron', 17, 'muted')}
      </div>`;
    }).join('');
  }

  function paint() {
    const c = counts();
    const total = photos.length;
    const bytes = photos.reduce((a, p) => a + (p.size || 0), 0);
    const st = statusOf(batch, c);
    const missing = CATEGORIES.filter(k => (c[k.key] || 0) < requiredOf(batch, k.key));
    const doneCats = CATEGORIES.length - missing.length;
    const pct = Math.round(doneCats / CATEGORIES.length * 100);

    content.innerHTML = `
      <div class="card info-card">
        <div class="row">
          <span class="pill ${st.cls}">${st.text}</span>
          <span class="grow"></span>
          <span class="tiny muted">更新 ${fmtRelative(batch.updatedAt || batch.createdAt)}</span>
        </div>
        <div class="i-no" style="margin-top:9px">${escapeHtml(batch.batchNo)}</div>
        <div class="kv" style="margin-top:11px">${infoRows()}</div>
        ${batch.note ? `<div class="small muted" style="margin-top:10px;padding-top:9px;border-top:1px dashed var(--line)">备注：${escapeHtml(batch.note)}</div>` : ''}
      </div>

      <div class="section-title">拍照进度 <span class="line"></span> <span class="mono">${doneCats}/6 类</span></div>
      <div class="card" style="padding:13px 14px">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="small"><b>${total}</b> 张照片 · ${formatBytes(bytes)}</span>
          ${missing.length ? `<span class="pill warn">缺 ${missing.length} 类</span>` : `<span class="pill done">六类齐全</span>`}
        </div>
        <div class="progressbar"><i style="width:${pct}%"></i></div>
        <div class="small ${missing.length ? 'miss-text' : 'muted'}" style="margin-top:9px">
          ${missing.length ? '待拍：' + missing.map(k => escapeHtml(k.short)).join('、') : '每类照片均已达到最低张数'}
        </div>
        ${batch.status === 'submitted' ? `<div class="banner ok" style="margin-top:11px">${icon('lock', 17)}<div>已提交锁定，照片不可修改。需要补拍请先在右上角菜单解锁。</div></div>` : ''}
      </div>

      <div class="section-title">照片类别 <span class="line"></span> <span class="tiny">点一行直接拍照</span></div>
      <div class="card cat-list">${categoryRows(c)}</div>

      <div class="footnote" style="margin-top:14px">
        照片会烧入批次号、类别、时间与经纬度水印，并记录 SHA-256 校验值。
        每类最多 ${MAX_PER_CATEGORY} 张。
      </div>
    `;

    bar.innerHTML = batch.status === 'submitted'
      ? `<button class="btn ghost grow" id="bar-export">${icon('zip', 18)} 导出本批次</button>
         <button class="btn primary grow" id="bar-unlock">${icon('unlock', 18)} 解锁修改</button>`
      : `<button class="btn ghost grow" id="bar-export">${icon('zip', 18)} 导出本批次</button>
         <button class="btn seal grow" id="bar-submit">${icon('lock', 18)} 提交锁定</button>`;

    // 事件
    content.querySelector('[data-edit-inspector]')?.addEventListener('click', async () => {
      const updated = await openInspectorSheet(batch);
      if (updated) { batch = updated; await load(); toast('抽样人已更新'); }
    });

    content.querySelectorAll('[data-photo]').forEach(img => {
      img.addEventListener('click', e => {
        e.stopPropagation();
        navigate(`/photo/${img.dataset.photo}`);
      });
    });

    content.querySelectorAll('[data-cat]').forEach(row => {
      const open = () => openCategory(row.dataset.cat);
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });

    root.querySelector('#bar-export').onclick = () => navigate(`/export/${batch.id}`);
    if (batch.status === 'submitted') {
      root.querySelector('#bar-unlock').onclick = unlock;
    } else {
      root.querySelector('#bar-submit').onclick = submit;
    }
  }

  function openCategory(key) {
    const c = counts();
    const n = c[key] || 0;
    if (batch.status === 'submitted') {
      const list = photos.filter(p => p.category === key);
      if (list.length) navigate(`/photo/${list[0].id}`);
      else toast('该类别没有照片，解锁后可补拍');
      return;
    }
    if (n >= MAX_PER_CATEGORY) {
      toast(`「${cat(key).short}」最多 ${MAX_PER_CATEGORY} 张，请先删除再拍`);
      return;
    }
    navigate(`/camera/${batch.id}?cat=${key}`);
  }

  async function submit() {
    const c = counts();
    const missing = CATEGORIES.filter(k => (c[k.key] || 0) < requiredOf(batch, k.key));
    if (missing.length) {
      await confirmDialog({
        title: '还有类别未拍',
        message: `以下类别未达到最低张数：\n${missing.map(k => `· ${k.name}（${c[k.key] || 0}/${requiredOf(batch, k.key)}）`).join('\n')}\n\n提交后照片将锁定，缺失项会记录在导出清单中。`,
        okText: '仍要提交',
        cancelText: '返回补拍',
        danger: true,
      }).then(async ok => {
        if (!ok) {
          const first = missing[0];
          if (first) navigate(`/camera/${batch.id}?cat=${first.key}`);
          return;
        }
        await doSubmit();
      });
      return;
    }
    const ok = await confirmDialog({
      title: '提交并锁定',
      message: `本批次共 ${photos.length} 张照片，六类均已达到最低张数。\n提交后将锁定照片，防止误删误改。`,
      okText: '提交锁定',
    });
    if (ok) await doSubmit();
  }

  async function doSubmit() {
    batch.status = 'submitted';
    batch.submittedAt = Date.now();
    await putBatch(batch);
    await load();
    toast('已提交锁定');
  }

  async function unlock() {
    const ok = await confirmDialog({
      title: '解锁修改',
      message: '解锁后可补拍或删除照片。解除锁定会记录在操作历史中，确定继续吗？',
      okText: '解锁',
      danger: true,
    });
    if (!ok) return;
    batch.status = 'draft';
    batch.unlockedAt = Date.now();
    await putBatch(batch);
    await load();
    toast('已解锁，可继续拍照');
  }

  function openMenu() {
    const s = openSheet({
      title: '批次操作',
      body: `<div class="stack" style="gap:8px">
        <button class="btn ghost block" data-m="edit">${icon('edit', 18)} 编辑批次信息</button>
        <button class="btn ghost block" data-m="note">${icon('file', 18)} 编辑备注</button>
        <button class="btn ghost block" data-m="inspector">${icon('sign', 18)} 修改抽样人</button>
        ${batch.status === 'submitted' ? `<button class="btn ghost block" data-m="unlock">${icon('unlock', 18)} 解锁修改</button>` : ''}
        <button class="btn danger block" data-m="delete">${icon('trash', 18)} 删除本批次</button>
      </div>`,
    });
    s.el.querySelectorAll('[data-m]').forEach(btn => {
      btn.onclick = async () => {
        const m = btn.dataset.m;
        if (m === 'edit') {
          s.close();
          if (await openBatchForm(batch)) await load();
        } else if (m === 'note') {
          s.close();
          if (await openNoteSheet(batch)) await load();
        } else if (m === 'inspector') {
          s.close();
          if (await openInspectorSheet(batch)) await load();
        } else if (m === 'unlock') {
          s.close();
          await unlock();
        } else if (m === 'delete') {
          s.close();
          const ok = await confirmDialog({
            title: '删除批次',
            message: `将删除该批次及全部 ${photos.length} 张照片，且无法恢复。\n建议先导出备份。`,
            okText: '确认删除',
            danger: true,
          });
          if (ok) {
            await deleteBatch(batch.id);
            toast('批次已删除');
            navigate('/', { replace: true });
          }
        }
      };
    });
  }

  root.querySelector('#b-back').onclick = () => back('/');
  root.querySelector('#b-menu').onclick = openMenu;

  await load();

  return () => { alive = false; pool.revokeAll(); };
}
