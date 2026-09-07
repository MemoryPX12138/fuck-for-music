import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createClient } from 'webdav';
import ffmpegStatic from 'ffmpeg-static';
import { ConvertPool, workerCount } from './lib/pool.mjs';
import { SUPPORT_EXTS } from './lib/decrypt.mjs';
import { metadataGet } from './lib/metadata.mjs';
import { normaliseRemotePath, parseDirectoryEntries } from './lib/webdavDirs.mjs';
import { uploadFiles } from './lib/webdavUpload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.VITE_DEV_SERVER_URL;
app.setName('Fuck For Music');

let win = null;
let pool = null;

// ---------- 设置持久化 ----------
const configPath = () => path.join(app.getPath('userData'), 'config.json');
let settings = { outDir: '', webdav: { url: '', username: '', password: '', lastDir: '/' }, threads: workerCount(), theme: 'light', locale: 'zh-CN' };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(configPath(), 'utf8'))); } catch { /* 首次运行 */ }
}
function saveSettings() {
  try { fs.writeFileSync(configPath(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); }
}

const THEME_BG = { light: '#F5F3ED', dark: '#1B1A17' }; // V3：canvas 中性底（避免主题切换闪白）
function themeBg() { return settings.theme === 'dark' ? THEME_BG.dark : THEME_BG.light; }

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 980, minHeight: 640,
    backgroundColor: themeBg(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  if (isDev) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  loadSettings();
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- 对话框 ----------
ipcMain.handle('dialog:selectFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择要转换的音乐文件',
    filters: [{ name: '加密音乐文件', extensions: SUPPORT_EXTS }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return r.filePaths.filter((p) => SUPPORT_EXTS.includes(path.extname(p).slice(1).toLowerCase()));
});

ipcMain.handle('dialog:selectFolder', async (_e, title = '选择文件夹') => {
  const r = await dialog.showOpenDialog(win, { title, properties: ['openDirectory'] });
  return r.canceled ? '' : r.filePaths[0];
});

ipcMain.handle('dialog:selectAudioFiles', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '添加本地音乐文件',
    filters: [{ name: '音频文件', extensions: ['flac', 'mp3', 'ogg', 'm4a', 'wav', 'ape', 'wma'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});

// ---------- 转换 ----------
function walkDir(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walkDir(p, out);
    else if (SUPPORT_EXTS.includes(path.extname(p).slice(1).toLowerCase())) out.push(p);
  }
}

ipcMain.handle('convert:pick', async (_e, mode) => {
  // mode: 'files' | 'folder'；返回待转换文件列表（不启动转换）
  if (mode === 'folder') {
    const dir = await dialog.showOpenDialog(win, { title: '选择包含加密音乐的文件夹', properties: ['openDirectory'] });
    if (dir.canceled) return [];
    const found = [];
    walkDir(dir.filePaths[0], found);
    return found;
  }
  const r = await dialog.showOpenDialog(win, {
    title: '选择要转换的音乐文件',
    filters: [{ name: '加密音乐文件', extensions: SUPPORT_EXTS }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return [];
  return r.filePaths.filter((p) => SUPPORT_EXTS.includes(path.extname(p).slice(1).toLowerCase()));
});

ipcMain.handle('convert:start', async (_e, { files, outDir }) => {
  if (pool) return { error: '已有转换任务在进行中' };
  if (!files || !files.length) return { error: '没有待转换的文件' };
  fs.mkdirSync(outDir, { recursive: true });
  const list = files.map((src) => ({ src }));
  const send = (evt) => win?.webContents.send('convert:progress', evt);
  pool = new ConvertPool(list, outDir, settings.threads || workerCount(), send);
  send({ type: 'queued', total: list.length });
  const summary = await pool.run();
  pool = null;
  return summary;
});

ipcMain.handle('convert:abort', () => { pool?.abort(); pool = null; return true; });

// ---------- 设置 ----------
ipcMain.handle('settings:get', () => ({ ...settings, threadsMax: workerCount(), cpuCount: os.cpus().length }));
ipcMain.handle('settings:set', (_e, patch) => {
  Object.assign(settings, patch);
  if (patch.webdav) Object.assign(settings.webdav, patch.webdav);
  if (patch.theme) win?.setBackgroundColor(themeBg());
  saveSettings();
  return true;
});

// ---------- 应用信息 ----------
ipcMain.handle('app:info', () => ({ name: app.getName(), version: app.getVersion() }));

// ---------- 本地文件系统 ----------
ipcMain.handle('fs:scanAudio', (_e, dir) => {
  // 扫描输出目录中的音频文件（All in FnMusic 音乐库）
  const out = [];
  const wanted = new Set(['flac', 'mp3', 'ogg', 'm4a', 'wav', 'ape', 'wma']);
  (function walk(d) {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (wanted.has(path.extname(e.name).slice(1).toLowerCase())) {
        let st; try { st = fs.statSync(p); } catch { continue; }
        out.push({ path: p, name: e.name, size: st.size });
      }
    }
  })(dir);
  return out;
});

ipcMain.handle('fs:openPath', (_e, p) => { shell.openPath(p); return true; });
ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));

// ---------- WebDAV ----------
function wdavClient(cfg = {}) {
  const url = String(cfg?.url || '').trim();
  return createClient(url, {
    username: String(cfg?.username || ''),
    password: String(cfg?.password || ''),
    timeout: Number(cfg?.timeout) || 30000,
  });
}

ipcMain.handle('webdav:test', async (_e, cfg) => {
  try {
    if (!cfg?.url || !String(cfg.url).trim()) {
      return { ok: false, message: 'WebDAV URL is not configured' };
    }
    const client = wdavClient(cfg);
    await client.getDirectoryContents('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

ipcMain.handle('webdav:list', async (_e, { cfg, dir } = {}) => {
  try {
    if (!cfg?.url || !String(cfg.url).trim()) {
      return { ok: false, message: 'WebDAV URL is not configured' };
    }
    const client = wdavClient(cfg);
    const targetDir = normaliseRemotePath(dir || '/');
    // details:true 让库把 PROPFIND 的原始 props 一并带回，目录判定才有 resourcetype 可依据
    const res = await client.getDirectoryContents(targetDir, { details: true });
    const { entries, noTypeInfo } = parseDirectoryEntries(res, targetDir);
    return { ok: true, entries, noTypeInfo };
  } catch (e) {
    const target = normaliseRemotePath(dir || '/');
    return { ok: false, message: `Failed to list "${target}": ${String(e?.message || e)}` };
  }
});

ipcMain.handle('webdav:upload', async (_e, { cfg, remoteDir, files }) => {
  const send = (evt) => win?.webContents.send('webdav:progress', evt);
  const client = wdavClient(cfg);
  // 目标目录逐级创建
  const parts = String(remoteDir || '/').split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { if (!(await client.exists(cur))) await client.createDirectory(cur); } catch { /* 已存在 */ }
  }
  // 上传主体委托引擎（秒传/断点续传/原子收尾，见 lib/webdavUpload.mjs）
  try {
    return await uploadFiles({
      client,
      remoteDir,
      files,
      concurrency: Math.max(1, Math.min(8, Number(cfg.concurrency) || 3)),
      skipExisting: !!cfg.skipExisting,
      send,
    });
  } catch (e) {
    return { total: files.length, success: 0, fail: files.length, skipped: 0, results: [], error: String(e?.message || e) };
  }
});

// ---------- 播放器：音频准备 ----------
const NATIVE_AUDIO = new Set(['mp3', 'flac', 'ogg', 'oga', 'm4a', 'mp4', 'aac', 'wav', 'opus', 'webm', 'weba']);
const tempFiles = new Set();

function ffmpegBin() {
  let p = ffmpegStatic;
  const asarSep = `app.asar${path.sep}`;
  if (p.includes(asarSep)) p = p.replace(asarSep, `app.asar.unpacked${path.sep}`);
  // 兜底：若解包路径不存在则回退原路径
  if (!fs.existsSync(p)) p = ffmpegStatic;
  return p;
}

function cleanupTemp() {
  for (const f of tempFiles) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  tempFiles.clear();
}
app.on('will-quit', cleanupTemp);

ipcMain.handle('audio:prepare', async (_e, filePath) => {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (NATIVE_AUDIO.has(ext)) {
    return { ok: true, url: pathToFileURL(filePath).href, native: true };
  }
  // 非原生格式（ape/wma 等）用 ffmpeg 解码到临时 mp3
  try {
    const out = path.join(os.tmpdir(), `fmf-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegBin(), ['-y', '-i', filePath, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', out], { windowsHide: true });
      let err = '';
      p.stderr?.on('data', (d) => { err += d; });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error((err || `ffmpeg exit ${code}`).slice(0, 300)))));
    });
    tempFiles.add(out);
    return { ok: true, url: pathToFileURL(out).href, native: false, temp: out };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

// ---------- 播放器：元数据 / 歌词 ----------
ipcMain.handle('metadata:get', async (_e, filePath) => {
  try { return await metadataGet(filePath); }
  catch (e) { return { error: String(e?.message || e) }; }
});
