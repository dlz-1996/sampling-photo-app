/* 相机页：拍照、连拍、相册导入、GPS 水印 */

import { getBatch, getSettings, countPhotos, addPhoto, listPhotosByCategory } from '../db.js';
import { CATEGORIES, cat, requiredOf, MAX_PER_CATEGORY } from '../categories.js';
import { icon, escapeHtml, toast, uuid, createUrlPool } from '../util.js';
import { CameraController } from '../camera.js';
import { processPhoto, videoFrame } from '../watermark.js';
import { navigate, back } from '../router.js';

export async function render(root, { id, query }) {
  const batch = await getBatch(id);
  if (!batch) { toast('批次不存在'); navigate('/', { replace: true }); return; }

  const settings = await getSettings();
  let counts = (await countPhotos(id)).counts;
  let selected = CATEGORIES.some(c => c.key === query.cat) ? query.cat : CATEGORIES[0].key;
  let busy = false;
  let alive = true;
  let lastPhoto = null;
  const pool = createUrlPool();
  let lastUrl = '';

  root.innerHTML = `
    <div class="camera-screen">
      <video id="cam-video" autoplay playsinline muted></video>
      <div class="cam-grid on" id="cam-grid"></div>

      <div class="cam-top">
        <button class="icon-btn plain" id="cam-close" aria-label="关闭相机">${icon('close', 22)}</button>
        <div class="grow">
          <div class="cam-name">${escapeHtml(batch.batchNo)}</div>
        </div>
        <button class="icon-btn plain" id="cam-torch" aria-label="补光灯" title="补光灯">${icon('torch', 21)}</button>
        <button class="icon-btn plain" id="cam-gridbtn" aria-label="网格线" title="网格线">${icon('grid', 20)}</button>
      </div>

      <div class="cam-chips" id="cam-chips">
        ${CATEGORIES.map(c => `<button class="cam-chip" data-chip="${c.key}">${escapeHtml(c.short)} <span class="n" data-n="${c.key}"></span></button>`).join('')}
      </div>

      <div class="cam-status" id="cam-status">
        <span class="gps-dot" id="gps-dot"></span>
        <span id="gps-text">定位中…</span>
        <span class="grow"></span>
        <span id="cnt-text"></span>
      </div>

      <div class="cam-body">
        <div class="cam-fallback" id="cam-fallback" hidden>
          <div class="big">无法打开相机</div>
          <p id="fallback-msg">可以使用系统相机或相册，照片同样会加水印并归档。</p>
          <button class="btn seal block" id="fb-camera" style="max-width:280px">${icon('camera', 18)} 打开系统相机</button>
          <button class="btn ghost block" id="fb-album" style="max-width:280px;color:#f4f1ea;border-color:rgba(255,255,255,.3);background:transparent">${icon('album', 18)} 从相册选择</button>
          <p class="tiny" style="max-width:300px">相机需要 HTTPS 访问并在 Chrome 中授权。用微信内置浏览器打开时请改用 Chrome。</p>
        </div>
      </div>

      <div class="cam-bottom">
        <button class="cam-side" id="cam-album" aria-label="从相册导入">
          <span style="display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.12)">${icon('album', 21)}</span>
          <span>相册</span>
        </button>
        <button class="shutter" id="cam-shutter" aria-label="拍照"></button>
        <button class="cam-side" id="cam-last" aria-label="最近一张">
          <span class="cam-last" id="cam-last-box">${icon('image', 20)}</span>
          <span id="cam-last-text">最近</span>
        </button>
      </div>

      <div class="cam-flash" id="cam-flash"></div>

      <input type="file" accept="image/*" id="pick-album" multiple hidden>
      <input type="file" accept="image/*" capture="environment" id="pick-camera" hidden>
    </div>
  `;

  const video = root.querySelector('#cam-video');
  const chips = root.querySelector('#cam-chips');
  const gpsDot = root.querySelector('#gps-dot');
  const gpsText = root.querySelector('#gps-text');
  const cntText = root.querySelector('#cnt-text');
  const shutter = root.querySelector('#cam-shutter');
  const flashEl = root.querySelector('#cam-flash');
  const fallback = root.querySelector('#cam-fallback');
  const fallbackMsg = root.querySelector('#fallback-msg');
  const lastBox = root.querySelector('#cam-last-box');
  const lastText = root.querySelector('#cam-last-text');
  const pickAlbum = root.querySelector('#pick-album');
  const pickCamera = root.querySelector('#pick-camera');

  let gpsState = 'locating';

  const controller = new CameraController({
    video,
    onGps: ev => {
      if (!alive) return;
      gpsState = ev.state;
      if (ev.state === 'ok') {
        gpsDot.className = 'gps-dot ok';
        gpsText.textContent = `GPS ±${Math.round(ev.accuracy)}m`;
        gpsText.title = `${ev.lat.toFixed(6)}, ${ev.lng.toFixed(6)}`;
      } else if (ev.state === 'locating') {
        gpsDot.className = 'gps-dot';
        gpsText.textContent = '定位中…';
        gpsText.title = '';
      } else {
        gpsDot.className = 'gps-dot bad';
        gpsText.textContent = ev.state === 'denied' ? '未授权定位' : '定位不可用';
      }
    },
    onError: () => {},
  });

  function updateChips() {
    chips.querySelectorAll('[data-chip]').forEach(btn => {
      const k = btn.dataset.chip;
      const n = counts[k] || 0;
      const req = requiredOf(batch, k);
      btn.querySelector('[data-n]').textContent = `${n}/${req}`;
      btn.classList.toggle('active', k === selected);
    });
    const n = counts[selected] || 0;
    cntText.textContent = `${cat(selected).short} ${n}/${requiredOf(batch, selected)} · 最多 ${MAX_PER_CATEGORY}`;
    root.querySelectorAll('[data-chip]').forEach(b => {
      if (b.dataset.chip === selected) b.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }

  function setLastPhoto(photo) {
    lastPhoto = photo;
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = ''; }
    if (!photo) {
      lastBox.innerHTML = icon('image', 20);
      lastText.textContent = '最近';
      return;
    }
    lastUrl = pool.get(photo.thumb);
    lastBox.innerHTML = `<img src="${lastUrl}" alt="最近一张">`;
    lastText.textContent = cat(photo.category).short;
  }

  async function refreshLast() {
    const list = await listPhotosByCategory(id, selected);
    if (list.length) setLastPhoto(list[list.length - 1]);
    else setLastPhoto(null);
  }

  async function savePhoto(source, sourceKind, { silent = false } = {}) {
    const key = selected;
    if ((counts[key] || 0) >= MAX_PER_CATEGORY) {
      toast(`「${cat(key).short}」最多 ${MAX_PER_CATEGORY} 张，请先到批次里删除`);
      return false;
    }
    const takenAt = Date.now();
    const fix = controller.currentFix();
    const out = await processPhoto(source, {
      batchNo: batch.batchNo,
      categoryShort: cat(key).short,
      takenAt,
      gps: fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null,
      sourceKind,
      maxEdge: settings.maxEdge,
      quality: settings.quality,
      showTime: settings.showTime,
      showGps: settings.showGps,
    });
    const photo = {
      id: uuid(),
      batchId: id,
      category: key,
      seq: (counts[key] || 0) + 1,
      blob: out.blob,
      thumb: out.thumb,
      width: out.width,
      height: out.height,
      size: out.size,
      thumbSize: out.thumbSize,
      sha256: out.sha256,
      takenAt,
      source: sourceKind,
      lat: fix?.lat ?? null,
      lng: fix?.lng ?? null,
      accuracy: fix?.accuracy ?? null,
      note: '',
      createdAt: takenAt,
    };
    await addPhoto(photo);
    counts[key] = (counts[key] || 0) + 1;
    setLastPhoto(photo);
    updateChips();
    if (!silent) {
      const req = requiredOf(batch, key);
      toast(`已保存 · ${cat(key).short} ${counts[key]}/${req}`);
      if (navigator.vibrate) navigator.vibrate(22);
    }
    return true;
  }

  function fireFlash() {
    flashEl.classList.remove('fire');
    void flashEl.offsetWidth;
    flashEl.classList.add('fire');
  }

  async function capture() {
    if (busy) return;
    if ((counts[selected] || 0) >= MAX_PER_CATEGORY) {
      toast(`「${cat(selected).short}」最多 ${MAX_PER_CATEGORY} 张，请先删除`);
      return;
    }
    busy = true;
    shutter.classList.add('busy');
    fireFlash();
    try {
      let frame;
      try { frame = videoFrame(video); }
      catch {
        toast('相机尚未就绪，请稍等或用相册导入');
        return;
      }
      if (!frame) throw new Error('相机尚未就绪');
      await savePhoto(frame, 'camera');
    } catch (err) {
      console.error(err);
      toast('保存失败：' + (err.message || err));
    } finally {
      busy = false;
      shutter.classList.remove('busy');
    }
  }

  async function importFiles(files, sourceKind) {
    if (!files?.length) return;
    const remaining = MAX_PER_CATEGORY - (counts[selected] || 0);
    if (remaining <= 0) { toast('该类照片已达上限'); return; }
    const list = [...files].slice(0, remaining);
    if (files.length > remaining) toast(`该类最多还能加 ${remaining} 张，已忽略多余文件`);
    busy = true;
    shutter.classList.add('busy');
    let ok = 0;
    for (const file of list) {
      try {
        await savePhoto(file, sourceKind, { silent: true });
        ok++;
        toast(`正在导入 ${ok}/${list.length}…`, 1200);
      } catch (err) {
        console.error(err);
        toast(`「${file.name}」导入失败：${err.message || err}`, 3200);
      }
    }
    busy = false;
    shutter.classList.remove('busy');
    if (ok) toast(`已导入 ${ok} 张 · ${cat(selected).short} ${counts[selected]}/${requiredOf(batch, selected)}`);
  }

  function showFallback(err) {
    fallback.hidden = false;
    if (err?.name === 'NotAllowedError') {
      fallbackMsg.textContent = '相机权限被拒绝。可在 Chrome 地址栏左侧的锁形图标里允许相机，或直接用系统相机拍照。';
    } else if (err?.name === 'NotSupportedError' || !window.isSecureContext) {
      fallbackMsg.textContent = '当前页面不是安全连接（HTTPS），浏览器禁止网页调用相机。可改用系统相机/相册，或通过 HTTPS 地址打开。';
    } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
      fallbackMsg.textContent = '没有检测到可用摄像头。可改用系统相机或从相册选择。';
    }
  }

  /* ---------- 事件 ---------- */

  root.querySelector('#cam-close').onclick = () => back(`/batch/${id}`);
  chips.addEventListener('click', e => {
    const btn = e.target.closest('[data-chip]');
    if (!btn) return;
    selected = btn.dataset.chip;
    updateChips();
    refreshLast();
  });
  shutter.onclick = capture;
  root.querySelector('#cam-album').onclick = () => pickAlbum.click();
  root.querySelector('#cam-last').onclick = () => {
    if (lastPhoto) navigate(`/photo/${lastPhoto.id}`);
    else toast('还没有拍照');
  };
  root.querySelector('#cam-gridbtn').onclick = () => root.querySelector('#cam-grid').classList.toggle('on');
  root.querySelector('#cam-torch').onclick = async () => {
    try {
      const on = await controller.toggleTorch();
      toast(on ? '补光灯已开' : '补光灯已关', 1000);
    } catch (e) { toast(e.message || '补光灯不可用'); }
  };
  pickAlbum.addEventListener('change', async () => {
    const files = [...pickAlbum.files];
    pickAlbum.value = '';
    await importFiles(files, 'album');
  });
  pickCamera.addEventListener('change', async () => {
    const files = [...pickCamera.files];
    pickCamera.value = '';
    await importFiles(files, 'camera');
  });
  root.querySelector('#fb-camera').onclick = () => pickCamera.click();
  root.querySelector('#fb-album').onclick = () => pickAlbum.click();

  // 启动
  updateChips();
  const lastList = await listPhotosByCategory(id, selected);
  if (lastList.length) setLastPhoto(lastList[lastList.length - 1]);

  try {
    await controller.start();
  } catch (err) {
    console.warn('camera start failed', err);
    showFallback(err);
  }

  // 定位兜底：若页面本身有定位权限但 watch 失败，也在状态栏提示
  setTimeout(() => {
    if (alive && gpsState === 'locating') {
      gpsText.textContent = '定位中…（可继续拍照）';
    }
  }, 8000);

  return async () => {
    alive = false;
    await controller.stop();
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    pool.revokeAll();
  };
}
