<template>
  <div class="fnm">
    <!-- 库操作条 -->
    <div class="card toolbar">
      <div class="left">
        <span class="lib-title">{{ t('fnmusic.libTitle') }}</span>
        <span class="lib-count">{{ t('fnmusic.libCount', { n: library.length }) }}</span>
      </div>
      <div class="right">
        <button class="btn btn-ghost" @click="addLocal">{{ t('fnmusic.addLocal') }}</button>
        <button class="btn btn-ghost" @click="scanOut">{{ t('fnmusic.refresh') }}</button>
        <button class="btn btn-primary" :disabled="!library.length" @click="openNasBrowser">{{ t('fnmusic.upload') }}</button>
      </div>
    </div>

    <!-- 曲库平铺 -->
    <div class="lib" v-if="library.length">
      <div v-for="f in library" :key="f.path" class="card song-card" :title="f.path">
        <div class="song-badge" :data-ext="extOf(f.name).toLowerCase()">{{ extOf(f.name).toUpperCase() }}</div>
        <div class="song-meta">
          <div class="song-name">{{ f.name }}</div>
          <div class="song-size">{{ fmtSize(f.size) }}</div>
        </div>
        <button class="song-play" @click="play(f.path)" title="PLAY">▶</button>
        <button class="song-remove" @click="remove(f.path)" :title="t('fnmusic.remove')">×</button>
      </div>
    </div>
    <div class="empty card" v-else>
      <div class="empty-logo">☁</div>
      <h2>{{ t('fnmusic.empty.title') }}</h2>
      <p>{{ t('fnmusic.empty.desc') }}</p>
    </div>

    <!-- 上传进度弹窗 -->
    <transition name="fade">
      <div class="mask" v-if="uploading || uploadSummary">
        <div class="card dialog">
          <template v-if="uploading">
            <h3>{{ t('fnmusic.uploading') }}</h3>
            <div class="up-target">{{ uploadTarget }}</div>
            <div class="progress-wrap">
              <div class="progress-bar"><div class="progress-fill" :style="{ width: upPct + '%' }"></div></div>
              <span class="progress-text">{{ upFinished }} / {{ upTotal }}</span>
            </div>
            <div class="up-current">
              {{ upCurrent }}<template v-if="upInfoSuffix"> · {{ upInfoSuffix }}</template>
            </div>
          </template>
          <template v-else>
            <h3>{{ t('fnmusic.done.title') }}</h3>
            <div class="summary-nums">
              <div class="num total"><b>{{ uploadSummary.total }}</b><span>{{ t('fnmusic.done.total') }}</span></div>
              <div class="num ok"><b>{{ uploadSummary.success }}</b><span>{{ t('fnmusic.done.success') }}</span></div>
              <div class="num bad"><b>{{ uploadSummary.fail }}</b><span>{{ t('fnmusic.done.fail') }}</span></div>
              <div class="num skip"><b>{{ uploadSummary.skipped || 0 }}</b><span>{{ t('fnmusic.done.skipped') }}</span></div>
            </div>
            <div class="dialog-btns">
              <button class="btn btn-ghost" @click="uploadSummary = null">{{ t('btn.done') }}</button>
              <button class="btn btn-secondary" @click="openNasBrowser">{{ t('fnmusic.continueUpload') }}</button>
            </div>
          </template>
        </div>
      </div>
    </transition>

    <!-- NAS 文件夹选择 -->
    <transition name="fade">
      <div class="mask" v-if="browsing">
        <div class="card browser">
          <h3>{{ t('fnmusic.browse.title') }}</h3>
          <div class="wdav-info" v-if="wdavCfg.url">
            <span class="wdav-dot" :class="{ ok: wdavOk }"></span>{{ wdavCfg.url }}
          </div>
          <div class="wdav-info err" v-else>{{ t('fnmusic.browse.noconfig') }}</div>
          <div class="crumb">
            <button class="crumb-btn" @click="browse('/')">{{ t('fnmusic.browse.root') }}</button>
            <span v-for="(seg, i) in crumbs" :key="i" class="crumb-seg" @click="browse(seg.path)">{{ seg.name }}</span>
          </div>
          <div class="dir-list">
            <div v-if="browseMsg" class="dir-msg">{{ browseMsg }}</div>
            <div v-if="!dirs.length && !browseMsg" class="dir-empty">{{ t('fnmusic.browse.empty') }}</div>
            <div v-for="d in dirs" :key="d.path" class="dir-item" @click="browse(d.path)">
              <span class="dir-icon">▸</span>{{ d.name }}
            </div>
          </div>
          <div class="browser-btns">
            <button class="btn btn-ghost" @click="browsing = false">{{ t('btn.cancel') }}</button>
            <button class="btn btn-primary" :disabled="!wdavOk" @click="uploadTo()">{{ t('fnmusic.browse.uploadHere') }}</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useI18n } from '../i18n';
import { usePlayer } from '../player/usePlayer.js';
const { t } = useI18n();
const player = usePlayer();

const props = defineProps({ settings: Object, converted: Array });

const library = ref([]);
const browsing = ref(false);
const dirs = ref([]);
const browseMsg = ref('');
const curDir = ref('/');
const wdavOk = ref(false);
const uploading = ref(false);
const uploadSummary = ref(null);
const upTotal = ref(0); const upFinished = ref(0); const upCurrent = ref('');
const upFileInfo = ref(null); // { sent, size, resumed, instant } 当前文件字节级进度（断点续传/秒传）
const uploadTarget = ref('');

const wdavCfg = computed(() => props.settings.webdav || {});
const crumbs = computed(() => {
  const parts = curDir.value.split('/').filter(Boolean);
  let acc = '';
  return parts.map((p) => { acc += '/' + p; return { name: p, path: acc }; });
});
const upPct = computed(() => (upTotal.value ? Math.round((upFinished.value / upTotal.value) * 100) : 0));
// 当前文件的续传/秒传状态后缀：秒传 / 续传 xx% / 已传字节
const upInfoSuffix = computed(() => {
  const f = upFileInfo.value;
  if (!f || !f.size) return '';
  if (f.instant) return t('fnmusic.upload.instant');
  if (f.resumed && f.sent < f.size) return t('fnmusic.upload.resume', { pct: Math.round((f.sent / f.size) * 100) });
  return '';
});

onMounted(() => {
  window.fmf.onWebdavProgress((evt) => {
    if (evt.type === 'start') { upCurrent.value = evt.name; upFileInfo.value = null; }
    else if (evt.type === 'file') { upCurrent.value = evt.name; upFileInfo.value = evt; }
    else if (evt.type === 'done') { upFinished.value = evt.finished; }
  });
  scanOut();
});

watch(() => props.converted, (list) => {
  const seen = new Set(library.value.map((f) => f.path));
  for (const f of list) if (!seen.has(f.path)) library.value.push({ ...f, size: f.size || 0 });
}, { immediate: true, deep: true });

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1) : '';
}
function fmtSize(n) {
  if (!n) return '';
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}

function play(p) { player.enqueue([p]); }

async function scanOut() {
  if (!props.settings.outDir) return;
  const files = await window.fmf.scanAudio(props.settings.outDir);
  const seen = new Set(library.value.map((f) => f.path));
  for (const f of files) if (!seen.has(f.path)) library.value.push(f);
}

async function addLocal() {
  const files = await window.fmf.selectAudioFiles();
  const seen = new Set(library.value.map((f) => f.path));
  for (const p of files) {
    if (seen.has(p)) continue;
    seen.add(p);
    library.value.push({ path: p, name: p.split(/[\\/]/).pop(), size: 0 });
  }
}

function remove(p) { library.value = library.value.filter((f) => f.path !== p); }

// settings 是 reactive()，读出的 webdav 是 Vue Proxy；Proxy 无法被 IPC 结构化克隆，
// invoke 会直接抛 "An object could not be cloned"，跨进程前必须拷成纯对象
function plainCfg() {
  return JSON.parse(JSON.stringify(wdavCfg.value || {}));
}

// 列目录：克隆失败等异常也按 ok:false 处理，否则 browse() 会静默中断、留下空列表
async function listNas(dir) {
  try {
    return await window.fmf.webdavList({ cfg: plainCfg(), dir });
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
}

async function openNasBrowser() {
  if (!library.value.length) return;
  browsing.value = true;
  await browse(wdavCfg.value.lastDir || '/');
}

async function browse(dir) {
  curDir.value = dir;
  dirs.value = [];
  browseMsg.value = '';
  const r = await listNas(dir);
  if (r.ok) {
    dirs.value = r.entries || [];
    wdavOk.value = true;
    // 服务器没上报任何类型信息时，已退回「列出全部条目」，提示用户别当成空目录
    if (r.noTypeInfo) browseMsg.value = t('fnmusic.browse.noType');
    return;
  }
  wdavOk.value = false;
  browseMsg.value = t('fnmusic.browse.connectFail') + (r.message || '');
  // lastDir 等历史路径可能已失效：回退到根目录并明确告知，而不是留下一个空列表
  if (dir && dir !== '/') {
    const fallback = await listNas('/');
    if (fallback.ok) {
      curDir.value = '/';
      dirs.value = fallback.entries || [];
      wdavOk.value = true;
      browseMsg.value = t('fnmusic.browse.fallback', { dir });
    }
  }
}

async function uploadTo() {
  browsing.value = false;
  uploading.value = true;
  uploadTarget.value = (wdavCfg.value.url || '') + curDir.value;
  upTotal.value = library.value.length;
  upFinished.value = 0;
  window.fmf.setSettings({ webdav: { ...wdavCfg.value, lastDir: curDir.value } });
  const result = await window.fmf.webdavUpload({
    cfg: plainCfg(),
    remoteDir: curDir.value,
    files: library.value.map((f) => f.path),
  });
  uploading.value = false;
  uploadSummary.value = result;
}
</script>

<style scoped>
.fnm { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 32px; }

/* ── 库操作条 ── */
.toolbar { display: flex; align-items: center; justify-content: space-between; padding: 16px; gap: 16px; flex-wrap: wrap; }
.lib-title { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; }
.lib-count { font-size: 13px; line-height: 18px; color: var(--ink-faint); margin-left: 12px; }
.right { display: flex; gap: 12px; flex-wrap: wrap; }

/* ── 曲库平铺：列宽 310，卡片内距 16 ── */
.lib {
  flex: 1; min-height: 0; overflow-y: auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px; align-content: start; padding: 2px;
}
.song-card { position: relative; display: flex; align-items: center; gap: 12px; padding: 16px; }

/* 格式徽章：44×44 圆角 10，按格式族配色（浅底 + 深字） */
.song-badge {
  width: 44px; height: 44px; border-radius: 10px; display: grid; place-items: center;
  font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em; flex-shrink: 0;
  background: var(--mist-tint); color: var(--mist-deep); /* 有损族（MP3 等，默认） */
}
/* 无损族：FLAC / WAV / AIFF / ALAC → sage */
.song-badge[data-ext="flac"], .song-badge[data-ext="wav"],
.song-badge[data-ext="aiff"], .song-badge[data-ext="alac"] { background: var(--sage-tint); color: var(--sage-deep); }
/* 无损 APE → clay */
.song-badge[data-ext="ape"] { background: var(--clay-tint); color: var(--clay-deep); }
/* 加密族（NCM/KGM/QMC 等）→ 中性系 */
.song-badge[data-ext="ncm"], .song-badge[data-ext="kgm"], .song-badge[data-ext="kgma"],
.song-badge[data-ext="vpr"], .song-badge[data-ext="kwm"], .song-badge[data-ext="xm"],
.song-badge[data-ext="uc"], .song-badge[data-ext="x2m"], .song-badge[data-ext="x3m"],
.song-badge[data-ext="mflac"], .song-badge[data-ext="mflac0"], .song-badge[data-ext="mgg"],
.song-badge[data-ext="mgg0"], .song-badge[data-ext="mgg1"], .song-badge[data-ext="mggl"],
.song-badge[data-ext="mmp4"], .song-badge[data-ext="qmcflac"], .song-badge[data-ext="qmcogg"],
.song-badge[data-ext="qmc0"], .song-badge[data-ext="qmc2"], .song-badge[data-ext="qmc3"],
.song-badge[data-ext="qmc4"], .song-badge[data-ext="qmc6"], .song-badge[data-ext="qmc8"],
.song-badge[data-ext="bkcmp3"], .song-badge[data-ext="bkcm4a"], .song-badge[data-ext="bkcflac"],
.song-badge[data-ext="bkcwav"], .song-badge[data-ext="bkcape"], .song-badge[data-ext="bkcogg"],
.song-badge[data-ext="bkcwma"], .song-badge[data-ext="tkm"], .song-badge[data-ext="mg3d"],
.song-badge[data-ext="tm0"], .song-badge[data-ext="tm2"], .song-badge[data-ext="tm3"],
.song-badge[data-ext="tm6"], .song-badge[data-ext="cache"] { background: var(--wait-tint); color: var(--wait); }

.song-meta { min-width: 0; flex: 1; }
.song-name { font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: -0.2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song-size { font-size: 11px; line-height: 16px; color: var(--ink-soft); margin-top: 3px; font-variant-numeric: tabular-nums; }

/* 播放按钮：交互收敛到 sage 层（单一强调） */
.song-play {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--sage-tint); color: var(--sage-deep);
  display: grid; place-items: center; font-size: 10px; flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.song-play:hover { background: var(--sage-deep); color: var(--on-accent); }
.song-remove {
  position: absolute; top: 6px; right: 8px; width: 20px; height: 20px; border-radius: 50%;
  background: transparent; color: var(--ink-faint); font-size: 14px; line-height: 1;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.song-remove:hover { background: var(--bad-tint); color: var(--bad); }

/* ── 空态 ── */
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--ink-soft); }
.empty-logo { font-size: 44px; color: var(--mist); }
.empty h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; color: var(--ink); }
.empty p { font-size: 15px; line-height: 22px; letter-spacing: -0.1px; }

/* ── 弹窗：圆角 24 / 内边距 32 / 唯一投影档 ── */
.mask {
  position: fixed; inset: 0; background: rgba(35, 33, 28, 0.42);
  backdrop-filter: blur(6px); display: grid; place-items: center; z-index: 50;
}
:root[data-theme="dark"] .mask { background: rgba(0, 0, 0, 0.5); }
.dialog { width: 440px; padding: 32px; border-radius: 24px; text-align: center; box-shadow: var(--shadow); }
.dialog h3 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; }
.up-target { font-size: 13px; line-height: 18px; color: var(--ink-soft); margin: 12px 0 24px; word-break: break-all; }
.progress-wrap { display: flex; align-items: center; gap: 12px; }
.progress-bar { flex: 1; height: 10px; background: var(--wait-tint); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; transition: width 0.25s ease; background: linear-gradient(90deg, var(--sage), var(--mist)); }
.progress-text { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.up-current { margin-top: 16px; font-size: 13px; line-height: 18px; color: var(--ink-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-nums { display: flex; justify-content: center; gap: 32px; margin: 24px 0 24px; }
.num { display: flex; flex-direction: column; gap: 4px; }
.num b { font-size: 34px; line-height: 42px; font-weight: 600; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
.num span { font-size: 13px; line-height: 18px; color: var(--ink-soft); }
.num.total b { color: var(--ink); } .num.ok b { color: var(--ok); } .num.bad b { color: var(--bad); }
.num.skip b { color: var(--mist-deep); }
.dialog-btns { display: flex; justify-content: center; gap: 12px; }

/* ── NAS 文件夹浏览器 ── */
.browser { width: 460px; padding: 32px; border-radius: 24px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow); }
.browser h3 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; }
.wdav-info { font-size: 13px; line-height: 18px; color: var(--ink-soft); display: flex; align-items: center; gap: 8px; }
.wdav-info.err { color: var(--bad); }
.wdav-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--wait); }
.wdav-dot.ok { background: var(--ok); }
.crumb { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.crumb-btn, .crumb-seg {
  font-size: 13px; line-height: 18px; color: var(--sage-deep); background: transparent;
  padding: 3px 6px; border-radius: 6px;
}
.crumb-btn:hover, .crumb-seg:hover { text-decoration: underline; }
.crumb-seg:not(:last-child)::after { content: '/'; color: var(--ink-faint); margin-left: 4px; }
.dir-list { height: 260px; overflow-y: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px; background: var(--panel); }
.dir-item { padding: 8px 12px; border-radius: 6px; font-size: 15px; line-height: 22px; letter-spacing: -0.1px; cursor: pointer; display: flex; gap: 8px; align-items: center; transition: background-color 0.15s ease; }
.dir-item:hover { background: var(--sage-tint); }
.dir-icon { color: var(--mist); font-size: 11px; }
.dir-empty { padding: 24px; text-align: center; font-size: 13px; line-height: 18px; color: var(--ink-faint); }
.dir-msg { padding: 8px 12px; font-size: 13px; line-height: 1.6; color: var(--ink-faint); word-break: break-all; }
.browser-btns { display: flex; justify-content: flex-end; gap: 12px; }
</style>
