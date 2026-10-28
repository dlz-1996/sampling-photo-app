/* 表单弹层：新建/编辑批次、快速改抽样人、备注 */

import { getBatch, listBatches, putBatch, getSettings } from './db.js';
import { CATEGORIES, MAX_PER_CATEGORY, defaultRequired } from './categories.js';
import { escapeHtml, openSheet, closeSheet, toast, uuid, icon } from './util.js';

function field(name, label, value = '', { required = false, placeholder = '', type = 'text', hint = '' } = {}) {
  return `<div class="field">
    <label for="f-${name}">${escapeHtml(label)}${required ? ' <span class="req">*</span>' : ''}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}"
      placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''} autocomplete="off">
    ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
  </div>`;
}

/**
 * 新建 / 编辑批次。保存成功后 resolve(true)。
 */
export async function openBatchForm(existing = null) {
  const settings = await getSettings();
  const b = existing || {
    batchNo: '',
    inspector: settings.inspectorDefault || '',
    sampledUnit: '',
    producer: '',
    product: '',
    sampleName: '',
    specModel: '',
    reportNo: '',
    bureau: '',
    note: '',
  };
  const reqCount = Number(existing?.required?.[CATEGORIES[0].key] || settings.required || 1);

  return new Promise(resolve => {
    let saved = false;
    const sheet = openSheet({
      title: existing ? '编辑批次' : '新建批次',
      body: `
        <div class="field-row">
          ${field('batchNo', '抽查批次号', b.batchNo, { required: true, placeholder: '如 浦口区市监质抽[2026]002号0025' })}
        </div>
        <div class="field-row">
          ${field('inspector', '抽样人', b.inspector, { required: true, placeholder: '本批次抽样人员' })}
          ${field('specModel', '规格型号', b.specModel, { placeholder: '如 MFZ/ABC4 / 8-65-20' })}
        </div>
        ${field('sampledUnit', '被抽样单位（抽样地点）', b.sampledUnit, { placeholder: '如 江北新区久之顺建材经营部' })}
        ${field('producer', '生产公司', b.producer)}
        <div class="field-row">
          ${field('product', '产品大类', b.product, { placeholder: '如 手提式灭火器' })}
          ${field('sampleName', '样品名称', b.sampleName, { placeholder: '如 手提式干粉灭火器' })}
        </div>
        <div class="field-row">
          ${field('bureau', '市场监督管理局', b.bureau, { placeholder: '如 南京市浦口区市场监督管理局' })}
          ${field('reportNo', '报告编号', b.reportNo, { placeholder: '选填' })}
        </div>
        <div class="field">
          <label for="f-required">每类照片至少</label>
          <select id="f-required" name="required">
            ${Array.from({ length: MAX_PER_CATEGORY }, (_, i) => i + 1)
              .map(n => `<option value="${n}" ${n === reqCount ? 'selected' : ''}>${n} 张</option>`).join('')}
          </select>
          <div class="hint">六类照片每类最低张数，最多可拍 ${MAX_PER_CATEGORY} 张/类。</div>
        </div>
        <div class="field">
          <label for="f-note">备注</label>
          <textarea id="f-note" name="note" placeholder="选填，如抽样现场情况">${escapeHtml(b.note || '')}</textarea>
        </div>
        <div class="banner info" style="margin-top:4px">
          ${icon('info', 17)}
          <div>批次信息仅保存在本机；照片文件不会自动上传。导出后可在电脑端按批次归档。</div>
        </div>
      `,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn primary" data-save>${existing ? '保存修改' : '创建批次'}</button>`,
      onClose: () => { if (!saved) resolve(false); },
    });

    const el = sheet.el;
    const val = name => el.querySelector(`[name="${name}"]`)?.value.trim() || '';
    const batchNoInput = el.querySelector('[name="batchNo"]');

    if (existing?.status === 'submitted') {
      batchNoInput.readOnly = true;
      batchNoInput.style.background = 'var(--paper-2)';
      const reqSel = el.querySelector('[name="required"]');
      if (reqSel) reqSel.disabled = true;
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.style.color = 'var(--seal)';
      hint.textContent = '已提交锁定：批次号和最低张数不可修改，需先解锁。';
      batchNoInput.closest('.field').appendChild(hint);
    }

    el.querySelector('[data-cancel]').onclick = () => { closeSheet(); resolve(false); };

    el.querySelector('[data-save]').onclick = async () => {
      const batchNo = val('batchNo');
      const inspector = val('inspector');
      if (!batchNo) { batchNoInput.focus(); toast('请填写抽查批次号'); return; }
      if (!inspector) { el.querySelector('[name="inspector"]').focus(); toast('请填写抽样人'); return; }

      const all = await listBatches();
      const dup = all.find(x => x.batchNo === batchNo && x.id !== existing?.id);
      if (dup) { toast('该批次号已存在，请勿重复创建'); return; }

      const n = Number(val('required')) || 1;
      const data = {
        ...(existing || {}),
        id: existing?.id || uuid(),
        batchNo,
        inspector,
        sampledUnit: val('sampledUnit'),
        producer: val('producer'),
        product: val('product'),
        sampleName: val('sampleName'),
        specModel: val('specModel'),
        bureau: val('bureau'),
        reportNo: val('reportNo'),
        note: val('note'),
        required: defaultRequired(n),
        status: existing?.status || 'draft',
        createdAt: existing?.createdAt || Date.now(),
      };
      await putBatch(data);
      saved = true;
      closeSheet();
      toast(existing ? '已保存' : '批次已创建');
      resolve(true);
    };

    setTimeout(() => { if (!existing) batchNoInput.focus(); }, 220);
  });
}

/** 快速修改抽样人 */
export function openInspectorSheet(batch) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title: '修改抽样人',
      body: `<div class="field">
        <label for="qi">抽样人 <span class="req">*</span></label>
        <input id="qi" value="${escapeHtml(batch.inspector || '')}" autocomplete="off">
        <div class="hint">仅影响本批次，水印与照片清单会使用该姓名。</div>
      </div>`,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn primary" data-save>保存</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    const input = s.el.querySelector('#qi');
    setTimeout(() => input.focus(), 200);
    s.el.querySelector('[data-cancel]').onclick = () => { closeSheet(); resolve(null); };
    s.el.querySelector('[data-save]').onclick = async () => {
      const v = input.value.trim();
      if (!v) { toast('抽样人不能为空'); return; }
      batch.inspector = v;
      const updated = await putBatch(batch);
      done = true;
      closeSheet();
      resolve(updated);
    };
  });
}

/** 备注编辑 */
export function openNoteSheet(batch) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title: '批次备注',
      body: `<div class="field">
        <label for="qn">备注</label>
        <textarea id="qn" placeholder="现场情况、交接说明等">${escapeHtml(batch.note || '')}</textarea>
      </div>`,
      foot: `<button class="btn ghost" data-cancel>取消</button>
             <button class="btn primary" data-save>保存</button>`,
      onClose: () => { if (!done) resolve(null); },
    });
    s.el.querySelector('[data-cancel]').onclick = () => { closeSheet(); resolve(null); };
    s.el.querySelector('[data-save]').onclick = async () => {
      batch.note = s.el.querySelector('#qn').value.trim();
      const updated = await putBatch(batch);
      done = true;
      closeSheet();
      resolve(updated);
    };
  });
}
