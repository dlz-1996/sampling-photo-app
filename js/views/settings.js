/* 设置页 */

import { getSettings, saveSettings, stats, requirePersistence, listBatches, putBatch, clearEverything } from '../db.js';
import { defaultRequired, MAX_PER_CATEGORY } from '../categories.js';
import { icon, escapeHtml, toast, formatBytes, openSheet, closeSheet, confirmDialog, toCSV, downloadBlob, shareFile, fmtTime } from '../util.js';
import { createBackup, restoreBackup } from '../exporter.js';
import { APP_VERSION, BUILD_DATE } from '../config.js';
import { navigate, back } from '../router.js';

export async function render(root) {
  let settings = await getSettings();
  let info = await stats();
  let persisted = false;
  try { persisted = !!(navigator.storage?.persisted && await navigator.storage.persisted()); } catch {}

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn plain" id="s-back" aria-label="返回">${icon('back', 22)}</button>
        <div class="grow"><h1 style="font-size:17px">设置</h1><div class="sub">水印 · 导出 · 数据</div></div>
      </header>
      <div class="screen-body" id="s-body"></div>
    </div>
  `;
  const body = root.querySelector('#s-body');

  function switchRow(id, label, desc, on) {
    return `<div class="switch-row">
      <div class="grow"><div class="s-label">${escapeHtml(label)}</div><div class="s-desc">${escapeHtml(desc)}</div></div>
      <button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}" aria-label="${escapeHtml(label)}"></button>
    </div>`;
  }

  function paint() {
    body.innerHTML = `
      <div class="settings-group card" style="padding:2px 14px;margin-top:2px">
        <h3>默认信息</h3>
        <div class="set-row">
          <div class="grow"><div class="s-label">默认抽样人</div><div class="s-desc">新建批次时自动带出，可逐批修改</div></div>
          <input type="text" id="set-inspector" value="${escapeHtml(settings.inspectorDefault || '')}" placeholder="姓名" style="width:120px">
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">每类最低张数</div><div class="s-desc">新建批次生效，单类上限 ${MAX_PER_CATEGORY} 张</div></div>
          <select id="set-required">
            ${Array.from({ length: MAX_PER_CATEGORY }, (_, i) => i + 1)
              .map(n => `<option value="${n}" ${n === Number(settings.required) ? 'selected' : ''}>${n} 张</option>`).join('')}
          </select>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">应用到未提交批次</div><div class="s-desc">把上面的最低张数同步到所有进行中的批次</div></div>
          <button class="btn ghost sm" id="apply-required">应用</button>
        </div>
      </div>

      <div class="settings-group card" style="padding:2px 14px">
        <h3>拍照与水印</h3>
        <div class="set-row">
          <div class="grow"><div class="s-label">照片长边</div><div class="s-desc">越大越清晰，占用也越大</div></div>
          <select id="set-edge">
            <option value="1280" ${settings.maxEdge === 1280 ? 'selected' : ''}>1280 px</option>
            <option value="1600" ${settings.maxEdge === 1600 ? 'selected' : ''}>1600 px</option>
            <option value="2048" ${settings.maxEdge === 2048 ? 'selected' : ''}>2048 px</option>
          </select>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">JPEG 质量</div><div class="s-desc">默认 85，兼顾清晰与体积</div></div>
          <select id="set-quality">
            <option value="0.75" ${settings.quality === 0.75 ? 'selected' : ''}>75</option>
            <option value="0.85" ${settings.quality === 0.85 ? 'selected' : ''}>85</option>
            <option value="0.92" ${settings.quality === 0.92 ? 'selected' : ''}>92</option>
          </select>
        </div>
        ${switchRow('set-time', '水印显示拍摄时间', '照片像素中烧入时间', settings.showTime)}
        ${switchRow('set-gps', '水印显示 GPS 经纬度', '无法定位时显示“GPS 未获取”', settings.showGps)}
      </div>

      <div class="settings-group card" style="padding:2px 14px">
        <h3>本机数据</h3>
        <div class="set-row">
          <div class="grow"><div class="s-label">占用空间</div><div class="s-desc">${info.batches} 个批次 · ${info.photos} 张照片</div></div>
          <span class="mono small">${formatBytes(info.bytes)}</span>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">防止自动清理</div><div class="s-desc">${persisted ? '已开启持久化存储' : '申请后浏览器不会自动回收照片'}</div></div>
          <button class="btn ghost sm" id="btn-persist">${persisted ? '已开启' : '申请'}</button>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">上次备份</div><div class="s-desc">${settings.lastBackupAt ? fmtTime(settings.lastBackupAt) : '还没有备份过'}</div></div>
        </div>
      </div>

      <div class="settings-group card" style="padding:2px 14px">
        <h3>备份与导入</h3>
        <div class="set-row">
          <div class="grow"><div class="s-label">全量备份</div><div class="s-desc">所有批次、照片与设置打包为 ZIP</div></div>
          <button class="btn ghost sm" id="btn-backup">${icon('download', 16)} 备份</button>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">从备份恢复</div><div class="s-desc">合并导入，已存在的批次不会重复</div></div>
          <button class="btn ghost sm" id="btn-restore">${icon('upload', 16)} 恢复</button>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">下载批次导入模板</div><div class="s-desc">CSV 表头，可用 Excel 编辑</div></div>
          <button class="btn ghost sm" id="btn-template">${icon('file', 16)} 模板</button>
        </div>
      </div>

      <div class="settings-group card" style="padding:2px 14px">
        <h3>关于</h3>
        <div class="set-row">
          <div class="grow"><div class="s-label">抽样拍照 v${APP_VERSION}</div><div class="s-desc">构建 ${BUILD_DATE} · 纯本地存储</div></div>
          <button class="btn ghost sm" id="btn-help">使用说明</button>
        </div>
        <div class="set-row">
          <div class="grow"><div class="s-label">清空全部数据</div><div class="s-desc">删除所有批次与照片，不可恢复</div></div>
          <button class="btn danger sm" id="btn-clear">清空</button>
        </div>
      </div>

      <div class="footnote" style="text-align:center;padding-bottom:24px">
        照片不会上传服务器。换手机或清理浏览器数据前，务必先做全量备份。
      </div>

      <input type="file" id="file-restore" accept=".zip,application/zip" hidden>
    `;

    bind();
  }

  function bind() {
    const save = async patch => {
      settings = await saveSettings(patch);
      toast('已保存', 1200);
    };

    body.querySelector('#set-inspector').addEventListener('change', e => save({ inspectorDefault: e.target.value.trim() }));
    body.querySelector('#set-required').addEventListener('change', async e => {
      await save({ required: Number(e.target.value) });
    });
    body.querySelector('#set-edge').addEventListener('change', e => save({ maxEdge: Number(e.target.value) }));
    body.querySelector('#set-quality').addEventListener('change', e => save({ quality: Number(e.target.value) }));

    body.querySelector('#set-time').onclick = async e => {
      const btn = e.currentTarget;
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
      await save({ showTime: on });
    };
    body.querySelector('#set-gps').onclick = async e => {
      const btn = e.currentTarget;
      const on = !btn.classList.contains('on');
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-checked', String(on));
      await save({ showGps: on });
    };

    body.querySelector('#apply-required').onclick = async () => {
      const n = Number(body.querySelector('#set-required').value);
      const batches = await listBatches();
      const open = batches.filter(b => b.status !== 'submitted');
      if (!open.length) { toast('没有进行中的批次'); return; }
      const ok = await confirmDialog({
        title: '应用最低张数',
        message: `将把 ${open.length} 个进行中批次的每类最低张数改为 ${n} 张，已拍照片不受影响。`,
        okText: '应用',
      });
      if (!ok) return;
      for (const b of open) {
        b.required = defaultRequired(n);
        await putBatch(b);
      }
      toast(`已更新 ${open.length} 个批次`);
    };

    body.querySelector('#btn-persist').onclick = async () => {
      const ok = await requirePersistence();
      persisted = ok;
      if (ok) { toast('已开启持久化存储'); info = await stats(); paint(); }
      else toast('浏览器未授予持久化，请定期备份', 2800);
    };

    body.querySelector('#btn-backup').onclick = async () => {
      if (!info.photos) { toast('还没有照片可备份'); return; }
      const done = busyMask('正在打包备份…');
      await new Promise(r => setTimeout(r, 60));
      try {
        const res = await createBackup();
        done();
        const how = await shareFile(res.blob, res.filename, '抽样拍照备份');
        settings = await saveSettings({ lastBackupAt: Date.now() });
        info = await stats();
        paint();
        if (how === 'downloaded') toast(`已保存 ${res.filename}（${formatBytes(res.blob.size)}）`, 3500);
        else if (how === 'shared') toast('备份已发送');
      } catch (e) {
        done();
        console.error(e);
        toast('备份失败：' + (e.message || e), 3500);
      }
    };

    const fileRestore = body.querySelector('#file-restore');
    body.querySelector('#btn-restore').onclick = () => fileRestore.click();
    fileRestore.addEventListener('change', async () => {
      const f = fileRestore.files?.[0];
      fileRestore.value = '';
      if (!f) return;
      const ok = await confirmDialog({
        title: '从备份恢复',
        message: '将把备份中的批次和照片合并到本机，已存在的批次/照片会自动跳过。\n恢复前建议先做一次备份。',
        okText: '开始恢复',
      });
      if (!ok) return;
      const done = busyMask('正在恢复…');
      await new Promise(r => setTimeout(r, 60));
      try {
        const res = await restoreBackup(f);
        done();
        info = await stats();
        paint();
        openSheet({
          title: '恢复完成',
          body: `<div class="stack small" style="line-height:1.9">
            <div>新增批次：<b>${res.restoredBatches}</b> / 备份中 ${res.totalBatches}</div>
            <div>新增照片：<b>${res.restoredPhotos}</b> / 备份中 ${res.totalPhotos}</div>
            <div class="muted">跳过已存在批次 ${res.skippedBatches} 个、照片 ${res.skippedPhotos} 张</div>
          </div>`,
          foot: `<button class="btn primary" data-close>好</button>`,
        });
      } catch (e) {
        done();
        console.error(e);
        toast('恢复失败：' + (e.message || e), 4000);
      }
    });

    body.querySelector('#btn-template').onclick = () => {
      const rows = [
        ['批次号', '市场监督管理局', '生产公司', '产品', '抽样地点', '样品名称', '规格型号', '报告编号', '抽样人'],
        ['浦口区市监质抽[2026]002号0025', '南京市浦口区市场监督管理局', '山东力盾消防科技有限公司', '手提式灭火器', '江北新区久之顺建材经营部', '手提式干粉灭火器', 'MFZ/ABC4', 'J2026JX0534', '张三'],
      ];
      downloadBlob(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), '照片任务导入模板.csv');
    };

    body.querySelector('#btn-help').onclick = help;
    body.querySelector('#btn-clear').onclick = async () => {
      const ok = await confirmDialog({
        title: '清空全部数据',
        message: `将删除 ${info.batches} 个批次、${info.photos} 张照片及全部设置，且无法恢复。\n确定已做好备份吗？`,
        okText: '确认清空',
        danger: true,
      });
      if (!ok) return;
      const ok2 = await confirmDialog({
        title: '再次确认',
        message: '这是不可撤销的操作。',
        okText: '删除全部',
        danger: true,
      });
      if (!ok2) return;
      await clearEverything();
      toast('已清空');
      navigate('/', { replace: true });
    };
  }

  function help() {
    openSheet({
      title: '使用说明',
      body: `
        <div class="stack small" style="line-height:1.85;color:var(--ink-2)">
          <div><b>1. 建批次</b>：从 CSV 导入，或右上角 + 新建。抽样人可逐批修改。</div>
          <div><b>2. 拍照片</b>：点类别行进入相机，六类照片每类至少 1 张、最多 10 张。</div>
          <div><b>3. 水印</b>：批次号、类别、时间、GPS 经纬度直接烧入图片像素。</div>
          <div><b>4. 锁定</b>：拍齐后点「提交锁定」，防止误删误改。</div>
          <div><b>5. 导出</b>：批次详情 → 导出本批次 → ZIP，通过分享面板存到电脑或发微信。</div>
          <div><b>6. 归档</b>：电脑项目目录运行 <span class="mono">python tools\\photo_ingest.py 文件.zip</span>，自动落到「照片归档」并校验。</div>
        </div>
        <div class="banner info" style="margin-top:14px">${icon('info', 17)}<div>相机必须用 Chrome 打开并允许权限；微信内置浏览器不支持调用相机。可先「添加到主屏幕」。</div></div>
        <div class="banner" style="margin-top:10px;background:#f6e9e5;border-color:#e8c8c0;color:#7d2d22">${icon('alert', 17)}<div>清除浏览器数据会删除照片。请每周做一次全量备份，重要批次导出后立即归档。</div></div>
      `,
      foot: `<button class="btn primary" data-close>知道了</button>`,
    });
  }

  function busyMask(text) {
    const mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.style.display = 'grid';
    mask.style.placeItems = 'center';
    mask.innerHTML = `<div class="card" style="padding:18px 24px;text-align:center;max-width:280px">
      <div class="skeleton" style="width:42px;height:42px;border-radius:50%;margin:0 auto 10px"></div>
      <div class="small">${escapeHtml(text)}</div></div>`;
    document.body.appendChild(mask);
    return () => mask.remove();
  }

  paint();
  root.querySelector('#s-back').onclick = () => back('/');
  return () => {};
}
