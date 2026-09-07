// 守护进程：监听 electron-builder 缓存目录，自动把 darwin/10.12/lib/lib*.dylib 空文件补为真实文件
const fs = require('fs');
const path = require('path');

const CACHE = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Local', 'electron-builder', 'Cache');
const BASE = path.join(CACHE, 'winCodeSign');
if (!fs.existsSync(BASE)) { console.error('cache not found:', BASE); process.exit(1); }

console.log('[fix-symlinks] watching:', BASE);

const seen = new Set(fs.readdirSync(BASE).filter((n) => !n.endsWith('.7z')));

function fixDir(d) {
  const libDir = path.join(d, 'darwin', '10.12', 'lib');
  if (!fs.existsSync(libDir)) return;
  for (const name of ['libcrypto', 'libssl']) {
    const dst = path.join(libDir, name + '.dylib');
    const src1 = path.join(libDir, name + '.1.0.0.dylib');
    try {
      const st = fs.statSync(dst);
      if (st.size === 0 && fs.existsSync(src1)) { fs.copyFileSync(src1, dst); console.log('[fix-symlinks] fixed', dst); }
    } catch (_) { /* file not exist yet */ }
  }
}

setInterval(() => {
  let items; try { items = fs.readdirSync(BASE); } catch (_) { return; }
  for (const name of items) {
    if (name.endsWith('.7z')) continue;
    if (seen.has(name)) continue;
    const full = path.join(BASE, name);
    try { if (fs.statSync(full).isDirectory()) fixDir(full); } catch (_) {}
    seen.add(name);
  }
}, 200);

// 进程退出清理
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));