/* CSV 批次导入 */

import { parseCSV, decodeTextBuffer, uuid } from './util.js';
import { listBatches, putBatch } from './db.js';
import { defaultRequired } from './categories.js';

const FIELDS = {
  batchNo: ['批次号', '抽查批次号', '批次编号', '任务批次号', '抽样批次号'],
  bureau: ['市场监督管理局', '市场监管局', '局', '部署局', '部署的市场监督管理局'],
  producer: ['生产公司', '生产企业', '标称生产企业', '生产单位', '标称生产单位'],
  product: ['产品', '产品大类', '抽查产品', '部署的产品', '产品类别'],
  sampledUnit: ['抽样地点', '被抽样单位', '受检单位', '单位在抽取', '经销单位', '销售单位'],
  sampleName: ['样品名称', '产品名称', '生产的产品', '样品'],
  specModel: ['规格型号', '型号规格', '规格', '型号'],
  reportNo: ['报告编号', '报告编号备注', '报告号', '报告编号（备注）'],
  inspector: ['抽样人', '抽样人员', '抽样员', '检查人员', '执法人员'],
};

function norm(s) {
  return String(s ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[_＿]+/g, '')
    .replace(/[（）()]/g, '')
    .replace(/[:：]/g, '')
    .toLowerCase();
}

const NORM_ALIASES = Object.fromEntries(
  Object.entries(FIELDS).map(([k, list]) => [k, list.map(norm)])
);

export async function importBatchCSV(file, settings = {}) {
  const buf = await file.arrayBuffer();
  const text = decodeTextBuffer(buf);
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV 中没有数据行');

  const headers = rows[0].map(norm);
  const index = {};
  for (const [field, aliases] of Object.entries(NORM_ALIASES)) {
    const i = headers.findIndex(h => aliases.includes(h));
    if (i >= 0) index[field] = i;
  }
  if (index.batchNo == null) {
    throw new Error('未找到“批次号”列，请检查 CSV 表头');
  }

  const existing = await listBatches();
  const seen = new Set(existing.map(b => b.batchNo));
  const skipped = [];
  let added = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = field => (index[field] != null ? String(row[index[field]] ?? '').trim() : '');
    const batchNo = get('batchNo');
    if (!batchNo) { skipped.push(`第 ${r + 1} 行：缺批次号`); continue; }
    if (seen.has(batchNo)) { skipped.push(`${batchNo}：已存在`); continue; }

    const inspector = get('inspector') || settings.inspectorDefault || '';
    const batch = {
      id: uuid(),
      batchNo,
      bureau: get('bureau'),
      producer: get('producer'),
      product: get('product'),
      sampledUnit: get('sampledUnit'),
      sampleName: get('sampleName'),
      specModel: get('specModel'),
      reportNo: get('reportNo'),
      inspector,
      note: '',
      required: defaultRequired(settings.required || 1),
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putBatch(batch);
    seen.add(batchNo);
    added++;
  }

  return { added, skipped, total: rows.length - 1 };
}
