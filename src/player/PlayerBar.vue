<template>
  <div class="player-bar">
    <div class="pb-cover" @click="player.expand(true)" :title="t('player.lyrics')">
      <img v-if="coverUrl" :src="coverUrl" class="pb-cover-img" alt="" />
      <div v-else class="pb-cover-ph"><Icon name="note" :size="20" /></div>
    </div>

    <div class="pb-mid" @click="player.expand(true)">
      <div class="pb-title">{{ curName || t('player.empty') }}</div>
      <div class="pb-sub">{{ artist || ' ' }}</div>
      <div class="pb-note" v-if="note">{{ note }}</div>
      <div class="pb-progress">
        <span class="pb-time">{{ fmt(curTime) }}</span>
        <input type="range" class="pb-range" :value="curTime" :max="dur || 0" step="0.1" @input="onSeek" @click.stop :disabled="!cur.url" />
        <span class="pb-time">{{ fmt(dur) }}</span>
      </div>
    </div>

    <div class="pb-ctrl">
      <button class="pb-btn" @click="player.prev"><Icon name="prev" :size="20" /></button>
      <button class="pb-btn pb-main" @click="player.toggle"><Icon :name="player.state.playing ? 'pause' : 'play'" :size="20" /></button>
      <button class="pb-btn" @click="player.next"><Icon name="next" :size="20" /></button>
    </div>

    <div class="pb-extra">
      <button class="pb-btn pb-open" @click="player.expand(true)" :title="t('player.lyrics')"><Icon name="lyrics" :size="22" /></button>
      <button class="pb-btn" @click="addAudio" :title="t('player.open')">＋</button>
      <input type="range" class="pb-vol" v-model.number="vol" min="0" max="1" step="0.05" />
    </div>

    <LyricsPanel />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { usePlayer } from './usePlayer.js';
import { useI18n } from '../i18n';
import Icon from './Icon.vue';
import LyricsPanel from './LyricsPanel.vue';
const { t } = useI18n();

const player = usePlayer();
const cur = computed(() => player.state.queue[player.state.current] || {});
const meta = computed(() => player.state.trackMeta || {});
const curName = computed(() => meta.value.title || cur.value.name || '');
const artist = computed(() => meta.value.artist || cur.value.artist || '');
const coverUrl = computed(() => meta.value.coverUrl || '');
const curTime = computed(() => player.state.currentTime);
const dur = computed(() => player.state.duration);
const vol = computed({
  get: () => player.state.volume,
  set: (v) => player.setVolume(Number(v)),
});
const note = computed(() => {
  if (player.state.status === 'decoding') return t('player.decoding');
  if (player.state.status === 'error' && player.state.error) return player.state.error;
  return '';
});

function fmt(s) {
  if (!s || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function onSeek(e) { player.seek(Number(e.target.value)); }
async function addAudio() {
  const files = await window.fmf.selectAudioFiles();
  if (files.length) player.enqueue(files);
}
</script>

<style scoped>
/* 播放条：panel 底 + 发丝线（克制材质，毛玻璃仅保留给浮层与分段控制器） */
.player-bar {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 64px; flex-shrink: 0;
  background: var(--panel);
  border-top: 1px solid var(--line);
  z-index: 40;
}

/* 封面：头像档圆角 10 */
.pb-cover { width: 46px; height: 46px; border-radius: 10px; overflow: hidden; flex-shrink: 0; background: var(--card); display: grid; place-items: center; color: var(--ink-faint); cursor: pointer; border: 1px solid var(--line); }
.pb-cover-img { width: 100%; height: 100%; object-fit: cover; }
.pb-cover-ph { display: grid; place-items: center; }

.pb-mid { flex: 1; min-width: 0; cursor: pointer; }
.pb-title { font-size: 15px; line-height: 22px; font-weight: 600; letter-spacing: -0.1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-sub { font-size: 13px; line-height: 18px; color: var(--ink-soft); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-note { font-size: 13px; line-height: 18px; color: var(--bad); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-progress { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.pb-range { flex: 1; accent-color: var(--sage-deep); height: 4px; }
.pb-time { font-size: 11px; line-height: 16px; color: var(--ink-soft); font-variant-numeric: tabular-nums; min-width: 38px; }

/* 走带控制：图标按钮 40×40 圆形（panel 底 + 发丝线） */
.pb-ctrl { display: flex; align-items: center; gap: 8px; }
.pb-btn {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--panel); color: var(--ink-soft); border: 1px solid var(--line);
  display: grid; place-items: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.pb-btn:hover { background: var(--card); color: var(--ink); }
.pb-btn:active { transform: scale(0.97); }
.pb-main { width: 44px; height: 44px; background: var(--sage-deep); color: var(--on-accent); border-color: transparent; }
.pb-main:hover { background: var(--accent-hover); color: var(--on-accent); }
.pb-open { color: var(--sage-deep); background: transparent; border-color: transparent; }
.pb-open:hover { color: var(--sage-deep); background: var(--sage-tint); }

.pb-extra { display: flex; align-items: center; gap: 12px; }
.pb-vol { width: 84px; accent-color: var(--mist-deep); }
</style>
