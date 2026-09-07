<template>
  <div class="board">
    <!-- 顶部操作区 -->
    <div class="card toolbar">
      <div class="pick-group">
        <button class="btn btn-secondary" :disabled="running" @click="pick('files')">{{ t('convert.pickFiles') }}</button>
        <button class="btn btn-ghost" :disabled="running" @click="pick('folder')">{{ t('convert.pickFolder') }}</button>
        <span class="hint">{{ t('convert.hint') }}</span>
      </div>
      <div class="out-group">
        <button class="btn btn-ghost" @click="chooseOut">{{ t('convert.outDir') }}</button>
        <span class="out-path" :title="outDir">{{ outDir || t('convert.outDirEmpty') }}</span>
      </div>
      <div class="run-group">
        <button v-if="!running" class="btn btn-primary" :disabled="!items.length || !outDir" @click="start">{{ t('convert.start') }}</button>
        <button v-else class="btn btn-danger" @click="abort">{{ t('convert.stop') }}</button>
      </div>
    </div>

    <!-- 统计条 -->
    <div class="card stats" v-if="items.length">
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: pct + '%' }"></div></div>
        <span class="progress-text">{{ done }} / {{ items.length }}</span>
      </div>
      <div class="chips">
        <span class="chip chip-total">{{ t('convert.pending') }} {{ pending }}</span>
        <span class="chip chip-run">{{ t('convert.running') }} {{ runningCount }}</span>
        <span class="chip chip-ok">{{ t('convert.success') }} {{ success }}</span>
        <span class="chip chip-bad">{{ t('convert.fail') }} {{ fail }}</span>
        <span class="threads">{{ t('convert.threads', { n: settings.threads || 4 }) }}</span>
      </div>
    </div>

    <!-- 平铺看板 -->
    <div class="kanban" v-if="items.length">
      <div v-for="it in items" :key="it.id" :class="['card file-card', it.status]">
        <div class="file-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="6" cy="18" r="3" fill="currentColor"/><circle cx="18" cy="16" r="3" fill="currentColor"/>
          </svg>
        </div>
        <div class="file-meta">
          <div class="file-name" :title="it.src">{{ it.name }}</div>
          <div class="file-sub">
            <span :class="['status', it.status]">{{ statusText(it) }}</span>
            <span v-if="it.dest" class="dest" :title="it.dest">{{ it.destName }}</span>
            <button v-if="it.status === 'success'" class="play-mini" @click="play(it.dest)" title="PLAY">▶</button>
          </div>
          <div class="file-err" v-if="it.status === 'fail' && it.message" :title="it.message">{{ it.message }}</div>
        </div>
        <div class="file-progress" v-if="it.status === 'running'"></div>
      </div>
    </div>

    <!-- 空态 -->
    <div class="empty card" v-else>
      <div class="empty-logo">♪</div>
      <h2>{{ t('convert.empty.title') }}</h2>
      <p>{{ t('convert.empty.desc') }}</p>
    </div>

    <!-- 完成汇总弹窗 -->
    <transition name="fade">
      <div class="mask" v-if="summary">
        <div class="card dialog">
          <h3>{{ t('convert.done.title') }}</h3>
          <div class="summary-nums">
            <div class="num total"><b>{{ summary.total }}</b><span>{{ t('convert.done.total') }}</span></div>
            <div class="num ok"><b>{{ summary.success }}</b><span>{{ t('convert.done.success') }}</span></div>
            <div class="num bad"><b>{{ summary.fail }}</b><span>{{ t('convert.done.fail') }}</span></div>
          </div>
          <p class="summary-hint">{{ t('convert.done.hint') }} {{ outDir }}</p>
          <div class="dialog-btns">
            <button class="btn btn-ghost" @click="summary = null">{{ t('btn.done') }}</button>
            <button class="btn btn-primary" :disabled="!summary.success" @click="goFnmusic">{{ t('convert.gotoFnmusic') }}</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from '../i18n';
import { usePlayer } from '../player/usePlayer.js';
const { t } = useI18n();
const player = usePlayer();

const props = defineProps({ settings: Object });
const emit = defineEmits(['converted', 'go-fnmusic']);

const items = ref([]);
const outDir = ref(props.settings.outDir || '');
const running = ref(false);
const summary = ref(null);
let off = null;

const done = computed(() => items.value.filter((i) => i.status === 'success' || i.status === 'fail').length);
const pending = computed(() => items.value.filter((i) => i.status === 'pending').length);
const runningCount = computed(() => items.value.filter((i) => i.status === 'running').length);
const success = computed(() => items.value.filter((i) => i.status === 'success').length);
const fail = computed(() => items.value.filter((i) => i.status === 'fail').length);
const pct = computed(() => (items.value.length ? Math.round((done.value / items.value.length) * 100) : 0));

onMounted(async () => {
  off = window.fmf.onConvertProgress(onProgress);
  if (props.settings.outDir) outDir.value = props.settings.outDir;
});
onUnmounted(() => off?.());

function statusText(it) {
  return { pending: t('convert.st.pending'), running: t('convert.st.running'), success: t('convert.st.success'), fail: t('convert.st.fail') }[it.status];
}

function play(dest) { player.enqueue([dest]); }

function onProgress(evt) {
  if (evt.type === 'queued') return;
  const it = items.value[evt.id];
  if (!it) return;
  if (evt.type === 'start') { it.status = 'running'; return; }
  if (evt.type === 'done') {
    it.status = evt.ok ? 'success' : 'fail';
    if (evt.ok) it.dest = evt.dest;
    else it.message = evt.message;
  }
}

async function pick(mode) {
  const files = await window.fmf.pickConvert(mode);
  if (!files.length) return;
  const seen = new Set(items.value.map((i) => i.src));
  let id = items.value.length;
  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    items.value.push({ id: id++, src: f, name: f.split(/[\\/]/).pop(), status: 'pending', dest: '', message: '' });
  }
}

async function chooseOut() {
  const dir = await window.fmf.selectFolder('选择转换结果保存文件夹');
  if (!dir) return;
  outDir.value = dir;
  window.fmf.setSettings({ outDir: dir });
}

async function start() {
  running.value = true;
  const files = items.value.filter((i) => i.status !== 'success').map((i) => i.src);
  const result = await window.fmf.convertStart({ files, outDir: outDir.value });
  running.value = false;
  if (result && !result.error) {
    summary.value = result;
    const okFiles = (result.results || []).filter((r) => r.ok).map((r) => ({ path: r.dest, name: r.dest.split(/[\\/]/).pop(), size: 0 }));
    emit('converted', okFiles);
  } else if (result?.error) {
    alert(result.error);
  }
}

async function abort() {
  await window.fmf.convertAbort();
  running.value = false;
}

function goFnmusic() {
  summary.value = null;
  emit('go-fnmusic');
}
</script>

<style scoped>
.board { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 32px; }

/* ── 工具栏：卡片内边距 16 ── */
.toolbar { display: flex; align-items: center; gap: 16px; padding: 16px; flex-wrap: wrap; }
.pick-group { display: flex; align-items: center; gap: 12px; }
.hint { font-size: 13px; line-height: 18px; color: var(--ink-faint); }
.out-group { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
.out-path {
  font-size: 13px; line-height: 18px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 320px; direction: rtl; text-align: left;
}
.run-group { margin-left: auto; }

/* ── 统计条 ── */
.stats { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.progress-wrap { display: flex; align-items: center; gap: 12px; }
.progress-bar { flex: 1; height: 10px; background: var(--wait-tint); border-radius: 999px; overflow: hidden; }
.progress-fill {
  height: 100%; border-radius: 999px; transition: width 0.25s ease;
  background: linear-gradient(90deg, var(--sage), var(--mist)); /* V3 进度渐变：sage → mist */
}
.progress-text { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; line-height: 18px; font-weight: 600;
  padding: 4px 12px; border-radius: 999px;
}
.chip b { font-weight: 600; font-variant-numeric: tabular-nums; }
.chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.chip-total { background: var(--wait-tint); color: var(--wait); }
.chip-run { background: var(--run-tint); color: var(--run); }
.chip-ok { background: var(--ok-tint); color: var(--ok); }
.chip-bad { background: var(--bad-tint); color: var(--bad); }
.threads { margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ink-faint); }

/* ── 平铺看板：列宽 310，卡片内距 16 ── */
.kanban {
  flex: 1; min-height: 0; overflow-y: auto;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
  gap: 12px; align-content: start; padding: 2px;
}

/* 文件卡 · 四态三重编码：左色条 + 状态底图标 + 状态 chip */
.file-card {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 12px;
  padding: 16px; transition: border-color 0.2s ease, border-width 0.2s ease;
}
.file-card::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--wait);
}
.file-card.running { border-color: var(--run); border-width: 1.5px; }
.file-card.running::before { background: var(--run); }
.file-card.success::before { background: var(--ok); }
.file-card.fail::before { background: var(--bad); }

.file-icon {
  width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0;
  background: var(--wait-tint); color: var(--wait);
}
.file-card.running .file-icon { background: var(--run-tint); color: var(--run); }
.file-card.success .file-icon { background: var(--ok-tint); color: var(--ok); }
.file-card.fail .file-icon { background: var(--bad-tint); color: var(--bad); }

.file-meta { min-width: 0; flex: 1; }
.file-name { font-size: 17px; line-height: 24px; font-weight: 600; letter-spacing: -0.2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-sub { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.status { font-size: 11px; line-height: 16px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.status.pending { background: var(--wait-tint); color: var(--wait); }
.status.running { background: var(--run-tint); color: var(--run); }
.status.success { background: var(--ok-tint); color: var(--ok); }
.status.fail { background: var(--bad-tint); color: var(--bad); }
.dest { font-size: 11px; line-height: 16px; color: var(--ink-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-err {
  margin-top: 4px; font-size: 11px; line-height: 16px; color: var(--bad);
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.play-mini {
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--sage-tint); color: var(--sage-deep);
  font-size: 9px; display: grid; place-items: center; flex-shrink: 0;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.play-mini:hover { background: var(--sage-deep); color: var(--on-accent); }

/* 转换中：卡内嵌进度条（sage→mist 渐变 + 1.4s 脉冲动效） */
.file-progress {
  position: absolute; left: 0; right: 0; bottom: 0; height: 4px;
  background: linear-gradient(90deg, var(--sage), var(--mist));
  animation: np-pulse 1.4s ease-in-out infinite;
}
@keyframes np-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ── 空态 ── */
.empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--ink-soft); }
.empty-logo { font-size: 44px; color: var(--sage); }
.empty h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; color: var(--ink); }
.empty p { font-size: 15px; line-height: 22px; letter-spacing: -0.1px; }

/* ── 弹窗：圆角 24 / 内边距 32 / 全应用唯一投影档 ── */
.mask {
  position: fixed; inset: 0; background: rgba(35, 33, 28, 0.42);
  backdrop-filter: blur(6px); display: grid; place-items: center; z-index: 50;
}
:root[data-theme="dark"] .mask { background: rgba(0, 0, 0, 0.5); }
.dialog { width: 440px; padding: 32px; border-radius: 24px; text-align: center; box-shadow: var(--shadow); }
.dialog h3 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; }
.summary-nums { display: flex; justify-content: center; gap: 32px; margin: 24px 0 16px; }
.num { display: flex; flex-direction: column; gap: 4px; }
.num b { font-size: 34px; line-height: 42px; font-weight: 600; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
.num span { font-size: 13px; line-height: 18px; color: var(--ink-soft); }
.num.total b { color: var(--ink); }
.num.ok b { color: var(--ok); }
.num.bad b { color: var(--bad); }
.summary-hint { font-size: 13px; line-height: 18px; color: var(--ink-faint); margin-bottom: 24px; word-break: break-all; }
.dialog-btns { display: flex; justify-content: center; gap: 12px; }
</style>
