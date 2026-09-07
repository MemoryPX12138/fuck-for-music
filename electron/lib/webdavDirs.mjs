// WebDAV 目录列表解析。
// 不同 NAS / WebDAV 服务器对「目录」的表达差异很大：webdav 库只有在 PROPFIND
// 返回 <resourcetype><collection/></resourcetype> 时才会把 type 标成 "directory"，
// 只返回 getcontenttype: httpd/unix-directory、或 resourcetype 为空标签的服务器
// 会被标成 "file"，只按 type 过滤就会得到空列表。这里做多信号判定。
const DIR_MIME = 'httpd/unix-directory';
const DIR_TYPES = new Set(['directory', 'collection', 'dir', 'folder']);
const RESOURCETYPE_KEYS = ['resourcetype', 'lp1:resourcetype', 'D:resourcetype', 'd:resourcetype'];
const CONTENTTYPE_KEYS = ['getcontenttype', 'lp1:getcontenttype', 'D:getcontenttype', 'd:getcontenttype'];

/** 取 DAV props 里的属性（props 可能是对象或数组，命名空间前缀各家不同） */
function propOf(props, keys) {
  if (!props) return undefined;
  const list = Array.isArray(props) ? props : [props];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    for (const k of keys) {
      if (p[k] !== undefined && p[k] !== null) return p[k];
    }
  }
  return undefined;
}

/** resourcetype 中是否含 collection 标记 */
function hasCollection(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return /collection/i.test(value);
  if (Array.isArray(value)) return value.some(hasCollection);
  if (typeof value === 'object') {
    return Object.keys(value).some((k) => /collection/i.test(k)) || /collection/i.test(String(JSON.stringify(value)));
  }
  return false;
}

/** 把任意形式的路径整理成以 / 开头的远程路径 */
export function normaliseRemotePath(p) {
  let s = String(p ?? '').trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(s)) {
    const m = s.match(/^https?:\/\/[^/]+(\/.*)?$/i);
    s = m && m[1] ? m[1] : '/';
  }
  // 注意：webdav 库返回的 filename 已经是解码过的，这里不能再 decodeURIComponent，
  // 否则含 %25 之类的名字会被二次解码成错误的路径
  const out = [];
  for (const seg of s.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return '/' + out.join('/');
}

/** 单条记录是否为目录 */
export function isDirectoryItem(it) {
  if (!it || typeof it !== 'object') return false;
  const type = String(it.type ?? '').trim().toLowerCase();
  if (DIR_TYPES.has(type)) return true;
  if (it.isDirectory === true || it.isDir === true) return true;
  if (hasCollection(propOf(it.props, RESOURCETYPE_KEYS))) return true;
  const ct = String(propOf(it.props, CONTENTTYPE_KEYS) ?? it.mime ?? '').split(';')[0].trim().toLowerCase();
  if (ct === DIR_MIME || ct === 'text/directory') return true;
  if (/\/$/.test(String(it.href ?? ''))) return true;
  return false;
}

/** 该记录是否携带了任何可用于判断类型的线索 */
function hasTypeSignal(it) {
  if (!it || typeof it !== 'object') return false;
  if (DIR_TYPES.has(String(it.type ?? '').trim().toLowerCase())) return true;
  if (propOf(it.props, RESOURCETYPE_KEYS) !== undefined) return true;
  // 内容类型为空字符串等于没报（库对未返回 getcontenttype 的文件会填 ""）
  const ct = propOf(it.props, CONTENTTYPE_KEYS) ?? it.mime;
  if (ct !== undefined && ct !== null && String(ct).trim() !== '') return true;
  if (/\/$/.test(String(it.filename ?? it.href ?? ''))) return true;
  return false;
}

/** 取出列表数组：兼容数组返回与 { data } 详细返回 */
export function extractItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  for (const key of ['data', 'results', 'entries', 'items']) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

/**
 * 把 getDirectoryContents 的返回值整理成 [{ name, path }]。
 * @param raw      getDirectoryContents 的原始返回（数组或 { data }）
 * @param targetDir 本次请求的目录，用于剔除「自身」条目
 */
export function parseDirectoryEntries(raw, targetDir) {
  const items = extractItems(raw);
  const target = normaliseRemotePath(targetDir || '/');
  const dirs = [];
  const unknown = []; // 服务器没给出任何类型线索的条目
  const seen = new Set();

  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const itemPath = normaliseRemotePath(it.filename ?? it.path ?? it.href ?? '');
    if (itemPath === '/' || itemPath === target || seen.has(itemPath)) continue;
    const name = String(it.basename ?? it.name ?? '').trim() || itemPath.split('/').pop();
    if (!name || name === '.' || name === '..') continue;
    seen.add(itemPath);
    const entry = { name, path: itemPath };
    if (isDirectoryItem(it)) dirs.push(entry);
    else if (!hasTypeSignal(it)) unknown.push(entry);
  }

  // 一条目录都没认出来、却有「服务器没给类型」的条目时，
  // 退回展示这些条目——对文件夹选择器来说，这远好于一个空白列表
  const noTypeInfo = dirs.length === 0 && unknown.length > 0;
  const entries = noTypeInfo ? unknown : dirs;
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { entries, noTypeInfo };
}
