/* 照片类别定义（名称与顺序按业务要求固定） */

export const MAX_PER_CATEGORY = 10;
export const MIN_REQUIRED = 1;

export const CATEGORIES = [
  {
    key: 'license', no: '01', icon: 'store',
    name: '企业抽样（营业执照）',
    short: '营业执照',
    desc: '营业执照正本或副本，文字清晰可读',
  },
  {
    key: 'invoice', no: '02', icon: 'receipt',
    name: '购物票据（发票）',
    short: '购物票据',
    desc: '发票、进货单或购物凭证',
  },
  {
    key: 'sample', no: '03', icon: 'box',
    name: '现场取样（样品照片）',
    short: '现场取样',
    desc: '样品整体、铭牌型号、包装与数量',
  },
  {
    key: 'sealed', no: '04', icon: 'seal',
    name: '现场封样（封样）',
    short: '现场封样',
    desc: '封条、封样袋、封口与双方签字',
  },
  {
    key: 'slip', no: '05', icon: 'sign',
    name: '抽样单和签字',
    short: '抽样单签字',
    desc: '抽样单填写页、双方确认签字',
  },
  {
    key: 'transport', no: '06', icon: 'truck',
    name: '样品运输',
    short: '样品运输',
    desc: '运输包装、装车、交接状态',
  },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

export function cat(key) {
  return CATEGORY_MAP[key] || CATEGORIES[0];
}

export function folderName(key) {
  const c = cat(key);
  return `${c.no}_${c.name}`;
}

export function requiredOf(batch, key) {
  const n = Number(batch?.required?.[key]);
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_PER_CATEGORY, Math.round(n)) : 1;
}

export function defaultRequired(n = 1) {
  const v = Math.min(MAX_PER_CATEGORY, Math.max(MIN_REQUIRED, Math.round(Number(n) || 1)));
  return Object.fromEntries(CATEGORIES.map(c => [c.key, v]));
}

export const STATUS = {
  draft: { text: '未开始', cls: 'draft' },
  progress: { text: '进行中', cls: 'progress' },
  submitted: { text: '已提交', cls: 'done' },
};

export function statusOf(batch, counts) {
  if (batch.status === 'submitted') return STATUS.submitted;
  const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  return total > 0 ? STATUS.progress : STATUS.draft;
}
