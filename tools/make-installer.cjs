// 生成标准 NSIS 安装包：makensis 编译 tools/installer.nsi => dist_electron/Fuck For Music Setup.exe
// 安装器含完整向导（欢迎/选目录/进度/完成运行）、桌面+开始菜单快捷方式、
// 卸载器与「设置 → 应用和功能」注册表项（Uninstall/EstimatedSize 等）。
// V3.2.0 起替代旧的 7z SFX + PowerShell 方案。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// 可用环境变量覆盖：FMF_APP_DIR（便携版目录）、FMF_OUT（Setup.exe 输出路径）、FMF_NSIS_PATH（makensis 目录）
const APP_DIR = process.env.FMF_APP_DIR || path.join(ROOT, 'dist_electron', 'Fuck For Music-win32-x64');
const OUT = process.env.FMF_OUT || path.join(ROOT, 'dist_electron', 'Fuck For Music Setup.exe');
const NSI = path.join(__dirname, 'installer.nsi');
const APP_VERSION = require(path.join(ROOT, 'package.json')).version;

// NSIS 供应商目录（gitignore，缺失时自动下载官方便携包）
const NSIS_DIR = path.join(__dirname, 'nsis');
const NSIS_URL = 'https://prdownloads.sourceforge.net/nsis/nsis-3.10.zip';

function dirSizeKB(dir) {
  let total = 0;
  (function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else total += st.size;
    }
  })(dir);
  return Math.round(total / 1024);
}

function findMakensis() {
  const candidates = [];
  if (process.env.FMF_NSIS_PATH) candidates.push(path.join(process.env.FMF_NSIS_PATH, 'makensis.exe'));
  candidates.push(path.join(NSIS_DIR, 'makensis.exe'));
  candidates.push('C:\\Program Files\\NSIS\\makensis.exe');
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return null;
}

// makensis 缺失时自动下载官方 NSIS 便携包（curl + 7za 解压）
function ensureNsis() {
  const dl = path.join(ROOT, 'node_modules', '.cache', 'fmf-nsis.zip');
  fs.mkdirSync(path.dirname(dl), { recursive: true });
  console.log('[installer] 下载 NSIS 便携包…');
  execFileSync('curl', ['-L', '-sS', '-o', dl, '--max-time', '600', NSIS_URL], { stdio: 'inherit' });
  if (!fs.existsSync(dl) || fs.readFileSync(dl).subarray(0, 2).toString() !== 'PK') {
    throw new Error('NSIS 下载失败：' + NSIS_URL);
  }
  const sevenZip = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  console.log('[installer] 解压到 tools/nsis …');
  execFileSync(sevenZip, ['x', '-y', `-o${NSIS_DIR}`, dl], { stdio: 'ignore' });
  const nested = path.join(NSIS_DIR, 'nsis-3.10');
  if (fs.existsSync(nested)) { // zip 带顶层目录，拍平
    for (const name of fs.readdirSync(nested)) fs.renameSync(path.join(nested, name), path.join(NSIS_DIR, name));
    fs.rmdirSync(nested);
  }
  fs.rmSync(dl, { force: true });
}

async function main() {
  if (!fs.existsSync(APP_DIR)) {
    console.error('missing:', APP_DIR, '— run `npm run build:win` first.');
    process.exit(1);
  }
  if (!fs.existsSync(NSI)) {
    console.error('missing:', NSI);
    process.exit(1);
  }
  let makensis = findMakensis();
  if (!makensis) {
    ensureNsis();
    makensis = findMakensis();
  }
  if (!makensis) {
    console.error('makensis 未找到。请安装 NSIS 或设置 FMF_NSIS_PATH。');
    process.exit(1);
  }

  const sizeKB = dirSizeKB(APP_DIR);
  console.log(`[installer] NSIS 编译中（v${APP_VERSION}，安装体积约 ${(sizeKB / 1024).toFixed(1)} MB）…`);
  // defines 写入临时脚本而非命令行 -D：makensis 的命令行解析会按空格截断含空格路径。
  // 临时脚本与主脚本都带 UTF-8 BOM（makensis 按 ACP 读无 BOM 文件，中文路径会乱码）
  const entry = path.join(os.tmpdir(), `fmf-installer-${Date.now()}.nsi`);
  fs.writeFileSync(entry, '\ufeff' + [
    `!define VERSION "${APP_VERSION}"`,
    `!define APP_DIR "${APP_DIR}"`,
    `!define OUT "${OUT}"`,
    `!define EST_SIZE_KB ${sizeKB}`,
    `!include "${NSI}"`,
    '',
  ].join('\n'), 'utf8');
  try {
    execFileSync(makensis, [entry], { stdio: 'inherit' });
  } finally {
    try { fs.rmSync(entry, { force: true }); } catch { /* 临时文件残留无害 */ }
  }

  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log('[installer] created:', OUT, `(${mb} MB)`);
}

main().catch((e) => { console.error('[installer] 失败:', e); process.exit(1); });
