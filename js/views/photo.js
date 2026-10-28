/* 单张照片查看 */

import { getPhoto, getBatch, listPhotos, deletePhoto, putPhoto } from '../db.js';
import { cat } from '../categories.js';
import { icon, escapeHtml, toast, fmtTime, formatBytes, createUrlPool, openSheet, closeSheet, confirmDialog, copyText } from '../util.js';
import { navigate, back } from '../router.js';

export async function render(root, { id }) {
  let photo = await getPhoto(id);
  if (!photo) { toast('照片不存在'); navigate('/', { replace: true }); return; }
  const batch = await getBatch(photo.batchId);
  let photos = await listPhotos(photo.batchId);
  const pool = createUrlPool();
  let idx = photos.findIndex(p => p.id === photo.id);
  let alive = true;

  root.innerHTML = `
    <div class="viewer">
      <div class="viewer-head">
        <button class="icon-btn plain" id="v-back" aria-label="返回">${icon('back', 22)}</button>
        <div class="title" id="v-title"></div>
        <button class="icon-btn plain" id="v-note" aria-label="备注">${icon('edit', 20)}</button>
      </div>
      <div class="viewer-img" id="v-imgwrap"></div>
      <div class="viewer-meta" id="v-meta"></div>
    </div>
  `;

  const titleEl = root.querySelector('#v-title');
  const imgWrap = root.querySelector('#v-imgwrap');
  const metaEl = root.querySelector('#v-meta');

  function paint() {
    const p = photos[idx];
    if (!p) { back(`/batch/${photo.batchId}`); return; }
    titleEl.textContent = `${cat(p.category).name} · ${idx + 1}/${photos.length}`;

    const url = pool.get(p.blob);
    imgWrap.innerHTML = `<img src="${url}" alt="${escapeHtml(cat(p.category).short)}">`;

    const gps = (p.lat != null && p.lng != null)
      ? `GPS ${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}${p.accuracy ? ` ±${Math.round(p.accuracy)}m` : ''}`
      : 'GPS 未记录';
    const srcText = p.source === 'album' ? '相册导入' : (p.source === 'camera' ? '相机拍摄' : '系统相机');

    metaEl.innerHTML = `
      <div class="row wrap" style="gap:6px 12px">
        <span class="mono">${fmtTime(p.takenAt)}</span>
        <span>${escapeHtml(srcText)}</span>
        <span>${p.width}×${p.height}</span>
        <span>${formatBytes(p.size)}</span>
      </div>
      <div class="mono" style="margin-top:5px;color:rgba(244,241,234,.6)">${escapeHtml(gps)}</div>
      ${p.note ? `<div style="margin-top:7px;color:#f4f1ea">备注：${escapeHtml(p.note)}</div>` : ''}
      <div class="hash" style="margin-top:7px">SHA-256 ${escapeHtml(p.sha256 || '')}</div>
      <div class="viewer-nav" style="margin-top:9px">
        <button class="btn ghost grow" id="v-prev" style="min-height:38px;font-size:13px;background:rgba(255,255,255,.1);color:#f4f1ea;border-color:rgba(255,255,255,.18)" ${idx <= 0 ? 'disabled' : ''}>上一张</button>
        <button class="btn ghost grow" id="v-next" style="min-height:38px;font-size:13px;background:rgba(255,255,255,.1);color:#f4f1ea;border-color:rgba(255,255,255,.18)" ${idx >= photos.length - 1 ? 'disabled' : ''}>下一张</button>
      </div>
      <div class="viewer-actions">
        <button class="btn" id="v-copy">${icon('copy', 16)} 复制校验值</button>
        <button class="btn danger" id="v-del">${icon('trash', 16)} 删除</button>
      </div>
    `;

    root.querySelector('#v-prev').onclick = () => go(-1);
    root.querySelector('#v-next').onclick = () => go(1);
    root.querySelector('#v-copy').onclick = async () => {
      const ok = await copyText(p.sha256 || '');
      toast(ok ? '校验值已复制' : '复制失败');
    };
    root.querySelector('#v-del').onclick = remove;
    root.querySelector('#v-note').onclick = editNote;
  }

  function go(dir) {
    const n = idx + dir;
    if (n < 0 || n >= photos.length) return;
    idx = n;
    photo = photos[idx];
    navigate(`/photo/${photo.id}`, { replace: true });
  }

  async function editNote() {
    const p = photos[idx];
    const s = openSheet({
      title: '照片备注',
      body: `<div class="field"><label for="pn">备注</label>
        <textarea id="pn" placeholder="如：样品铭牌、封条编号等">${escapeHtml(p.note || '')}</textarea></div>`,
      foot: `<button class="btn ghost" data-close>取消</button>
             <button class="btn primary" data-save>保存</button>`,
    });
    s.el.querySelector('[data-save]').onclick = async () => {
      p.note = s.el.querySelector('#pn').value.trim();
      await putPhoto(p);
      closeSheet();
      paint();
      toast('备注已保存');
    };
  }

  async function remove() {
    const p = photos[idx];
    const ok = await confirmDialog({
      title: '删除照片',
      message: `删除后无法恢复。\n${cat(p.category).name} · ${fmtTime(p.takenAt)}`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    await deletePhoto(p.id);
    photos = photos.filter(x => x.id !== p.id);
    if (!photos.length) {
      toast('已删除');
      navigate(`/batch/${p.batchId}`, { replace: true });
      return;
    }
    idx = Math.min(idx, photos.length - 1);
    photo = photos[idx];
    paint();
    toast('已删除');
  }

  // 左右滑动切换
  let tx = 0, ty = 0;
  imgWrap.addEventListener('touchstart', e => {
    tx = e.changedTouches[0].clientX;
    ty = e.changedTouches[0].clientY;
  }, { passive: true });
  imgWrap.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  root.querySelector('#v-back').onclick = () => back(`/batch/${photo.batchId}`);

  paint();
  return () => { alive = false; pool.revokeAll(); };
}
