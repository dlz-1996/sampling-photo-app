/* 极简 hash 路由 */

let renderFn = null;

export function setRouter(fn) { renderFn = fn; }

export function parseHash() {
  let raw = location.hash.replace(/^#/, '');
  if (!raw) raw = '/';
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const qs = qi >= 0 ? raw.slice(qi + 1) : '';
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || '/', query };
}

export function currentPath() {
  return parseHash().path;
}

export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) {
    renderFn?.();
    return;
  }
  if (replace) {
    history.replaceState(null, '', target);
    renderFn?.();
  } else {
    location.hash = target;
  }
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback);
}

export function startRouter() {
  window.addEventListener('hashchange', () => renderFn?.());
  renderFn?.();
}
