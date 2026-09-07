// 手工组装便携版（electron-packager 在受限环境下不可靠的替代方案）
// 流程：解压官方 electron zip → 装入应用文件 → 按依赖图复制生产 node_modules → rcedit 写入版本信息
// 依赖：本地 electron 缓存（%LOCALAPPDATA%/electron/Cache）、7-Zip（C:\Program Files\7-Zip）
// 用法：node tools/make-portable.cjs [版本号]（默认读 package.json）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const VERSION = process.argv[2] || require(path.join(ROOT, 'package.json')).version;
const APP_NAME = require(path.join(ROOT, 'package.json')).productName || 'Fuck For Music';
const OUT_ROOT = path.join(ROOT, 'dist_electron_v3');
const PKG_DIR = path.join(OUT_ROOT, `${APP_NAME}-win32-x64`);
const APP = path.join(PKG_DIR, 'resources', 'app');

const ELECTRON_VERSION = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const CACHE_ZIP = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache', `electron-v${ELECTRON_VERSION}-win32-x64.zip`);
const SEVENZIP_CANDIDATES = [
  process.env.FMF_7ZIP_PATH && path.join(process.env.FMF_7ZIP_PATH, '7z.exe'),
  'C:\\Program Files\\7-Zip\\7z.exe',
  path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
].filter(Boolean);

function find7z() {
  for (const c of SEVENZIP_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('未找到 7-Zip');
}

// ── 生产依赖图解析（扁平 node_modules 布局，含嵌套兜底） ──
function collectProdDeps() {
  const root = require(path.join(ROOT, 'package.json'));
  const visited = new Set();
  const order = [];
  function resolveDir(name, baseNm) {
    const candidates = [
      path.join(baseNm, name),
      path.join(ROOT, 'node_modules', name),
    ];
    for (const d of candidates) {
      if (fs.existsSync(path.join(d, 'package.json'))) return d;
    }
    return null;
  }
  function walk(deps, baseNm) {
    for (const name of Object.keys(deps || {})) {
      const dir = resolveDir(name, baseNm);
      if (!dir) { console.warn('[deps] 未找到:', name); continue; }
      if (visited.has(dir)) continue;
      visited.add(dir);
      order.push(dir);
      let pkg;
      try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { continue; }
      walk(pkg.dependencies, baseNm);
      // 处理嵌套 node_modules（如 electron-packager/node_modules/@electron/notarize）
      const nestedNm = path.join(dir, 'node_modules');
      if (fs.existsSync(nestedNm)) {
        for (const entry of fs.readdirSync(nestedNm)) {
          const nested = path.join(nestedNm, entry);
          if (!fs.existsSync(path.join(nested, 'package.json'))) continue;
          if (visited.has(nested)) continue;
          visited.add(nested);
          order.push(nested);
          try {
            const np = JSON.parse(fs.readFileSync(path.join(nested, 'package.json'), 'utf8'));
            walk(np.dependencies, nestedNm);
          } catch { /* ignore */ }
        }
      }
    }
  }
  walk(root.dependencies, path.join(ROOT, 'node_modules'));
  return order;
}

function main() {
  if (!fs.existsSync(CACHE_ZIP)) throw new Error('Electron 缓存 zip 不存在: ' + CACHE_ZIP);
  const sevenZip = find7z();
  fs.mkdirSync(PKG_DIR, { recursive: true });
  fs.mkdirSync(APP, { recursive: true });

  // 1. 解压 electron 运行时（幂等：exe 已存在则跳过）
  const exePath = path.join(PKG_DIR, `${APP_NAME}.exe`);
  if (!fs.existsSync(exePath)) {
    console.log('[portable] 解压 electron runtime...');
    execFileSync(sevenZip, ['x', '-y', CACHE_ZIP, `-o${PKG_DIR}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    fs.renameSync(path.join(PKG_DIR, 'electron.exe'), exePath);
  }

  // 2. 应用文件
  console.log('[portable] 复制应用文件...');
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(APP, 'package.json'));
  fs.cpSync(path.join(ROOT, 'electron'), path.join(APP, 'electron'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'dist'), path.join(APP, 'dist'), { recursive: true });

  // 3. 生产依赖
  console.log('[portable] 复制生产依赖...');
  const dirs = collectProdDeps();
  for (const src of dirs) {
    const rel = path.relative(ROOT, src);
    const dest = path.join(APP, rel);
    fs.cpSync(src, dest, { recursive: true });
  }
  console.log(`[portable] 生产依赖 ${dirs.length} 个包完成`);

  // 4. rcedit 写入版本信息（对齐 electron-packager --app-version 行为）
  console.log('[portable] rcedit 版本信息...');
  const rcedit = require(path.join(ROOT, 'node_modules', 'rcedit'));
  const run = (typeof rcedit === 'function') ? rcedit : rcedit.rcedit || rcedit.default;
  Promise.resolve(run(exePath, {
    'version-string': {
      ProductName: APP_NAME,
      FileVersion: VERSION,
      ProductVersion: VERSION,
      OriginalFilename: `${APP_NAME}.exe`,
    },
    'file-version': VERSION,
    'product-version': VERSION,
  })).then(() => {
    const mb = (getDirSize(PKG_DIR) / 1024 / 1024).toFixed(1);
    console.log(`[portable] 完成: ${PKG_DIR} (${mb} MB, v${VERSION})`);
  }).catch((e) => { console.error('[portable] rcedit 失败:', e.message); process.exit(1); });
}

function getDirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? getDirSize(p) : fs.statSync(p).size;
  }
  return total;
}

main();
