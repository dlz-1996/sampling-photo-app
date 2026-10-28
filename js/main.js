/* 应用入口：路由、错误兜底、Service Worker */

import { setRouter, startRouter, parseHash, navigate } from './router.js';
import { closeSheet, toast, icon, escapeHtml } from './util.js';
import { requirePersistence } from './db.js';
import { APP_NAME, APP_VERSION } from './config.js';

import * as listView from './views/list.js';
import * as batchView from './views/batch.js';
import * as cameraView from './views/camera.js';
import * as photoView from './views/photo.js';
import * as exportView from './views/export.js';
import * as settingsView from './views/settings.js';

const app = document.getElementById('app');
let cleanup = null;

function match(path, re) {
  const m = path.match(re);
  if (!m) return null;
  return m.slice(1).map(decodeURIComponent);
}

async function render() {
  const { path, query } = parseHash();
  closeSheet();
  if (cleanup) {
    try { await cleanup(); } catch (e) { console.warn(e); }
    cleanup = null;
  }
  app.innerHTML = '';
  window.scrollTo(0, 0);

  try {
    const mBatch = match(path, /^\/batch\/([^/]+)$/);
    const mCamera = match(path, /^\/camera\/([^/]+)$/);
    const mPhoto = match(path, /^\/photo\/([^/]+)$/);
    const mExport = match(path, /^\/export\/([^/]+)$/);

    if (path === '/') {
      document.title = `${APP_NAME} · 取证归档`;
      cleanup = await listView.render(app);
    } else if (mBatch) {
      document.title = `批次详情 · ${APP_NAME}`;
      cleanup = await batchView.render(app, { id: mBatch[0] });
    } else if (mCamera) {
      document.title = `拍照 · ${APP_NAME}`;
      cleanup = await cameraView.render(app, { id: mCamera[0], query });
    } else if (mPhoto) {
      document.title = `照片 · ${APP_NAME}`;
      cleanup = await photoView.render(app, { id: mPhoto[0] });
    } else if (path === '/settings') {
      document.title = `设置 · ${APP_NAME}`;
      cleanup = await settingsView.render(app);
    } else if (path === '/export' || mExport) {
      document.title = `导出 · ${APP_NAME}`;
      cleanup = await exportView.render(app, { id: mExport ? mExport[0] : null });
    } else {
      navigate('/', { replace: true });
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="screen">
      <header class="topbar"><div class="seal small">抽</div><div class="grow"><h1 style="font-size:17px">出错了</h1></div></header>
      <div class="screen-body">
        <div class="card" style="padding:16px">
          <div class="row" style="color:var(--seal)">${icon('alert', 20)}<b>页面加载失败</b></div>
          <p class="small muted" style="margin-top:8px;word-break:break-all">${escapeHtml(err.message || String(err))}</p>
          <button class="btn primary block" style="margin-top:14px" onclick="location.hash='#'">返回首页</button>
        </div>
      </div>
    </div>`;
  }
}

setRouter(render);
startRouter();

// 申请持久化存储（不阻塞启动）
setTimeout(() => { requirePersistence().catch(() => {}); }, 1500);

// 注册 Service Worker（离线可用）
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast(`已更新到 v${APP_VERSION}，下次打开生效`, 3200);
          }
        });
      });
    } catch (e) {
      console.warn('SW 注册失败', e);
    }
  });
}
