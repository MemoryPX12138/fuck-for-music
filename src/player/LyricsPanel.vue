<template>
  <Teleport to="body">
    <transition name="np">
      <div class="np" v-if="player.state.expanded" :style="{ background: bg }">
        <button class="np-close" @click="close"><Icon name="x" :size="20" /></button>

        <div class="np-body">
          <div class="np-left">
            <div class="np-art">
              <img v-if="coverUrl" :src="coverUrl" alt="cover" />
              <Icon v-else name="note" :size="64" />
            </div>
            <div class="np-title">{{ title }}</div>
            <div class="np-artist">{{ artist }}</div>

            <div class="np-time-row">
              <span class="np-time">{{ fmt(curTime) }}</span>
              <input type="range" class="np-range" :value="curTime" :max="dur || 0" step="0.1" @input="onSeek" :disabled="!cur.url" />
              <span class="np-time">{{ fmt(dur) }}</span>
            </div>

            <div class="np-ctl-row">
              <button class="np-ctl" :class="{ on: player.state.shuffle }" @click="player.toggleShuffle" :title="t('player.shuffle')"><Icon name="shuffle" :size="20" /></button>
              <button class="np-ctl np-ctl-lg" @click="player.prev" :title="t('player.prev')"><Icon name="prev" :size="26" /></button>
              <button class="np-play" @click="player.toggle" :title="player.state.playing ? t('player.pause') : t('player.play')"><Icon :name="player.state.playing ? 'pause' : 'play'" :size="30" /></button>
              <button class="np-ctl np-ctl-lg" @click="player.next" :title="t('player.next')"><Icon name="next" :size="26" /></button>
              <button class="np-ctl" :class="{ on: player.state.repeat !== 'off' }" @click="player.cycleRepeat" :title="t(repeatKey)"><Icon name="repeat" :size="20" /><span v-if="player.state.repeat === 'one'" class="np-r1">1</span></button>
            </div>

            <div class="np-vol">
              <Icon name="note" :size="16" />
              <input type="range" v-model.number="vol" min="0" max="1" step="0.05" />
            </div>
          </div>

          <div class="np-right">
            <div class="np-lyrics" ref="scrollRef">
              <div class="np-empty" v-if="!lines.length">{{ t('player.noLyrics') }}</div>
              <div v-for="(ln, i) in lines" :key="i" :class="['np-line', { active: i === active }]" @click="seekTo(ln.time)">{{ ln.text || '·' }}</div>
            </div>
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { usePlayer } from './usePlayer.js';
import { parseLrc, activeIndex } from './lrc.js';
import { useI18n } from '../i18n';
import Icon from './Icon.vue';
const { t } = useI18n();
const player = usePlayer();

const scrollRef = ref(null);
const vol = computed({
  get: () => player.state.volume,
  set: (v) => player.setVolume(Number(v)),
});

const cur = computed(() => player.state.queue[player.state.current] || {});
const meta = computed(() => player.state.trackMeta || {});
const coverUrl = computed(() => meta.value.coverUrl || '');
const title = computed(() => meta.value.title || cur.value.name || t('player.empty'));
const artist = computed(() => meta.value.artist || cur.value.artist || '');
const lines = computed(() => parseLrc(meta.value.lrc || ''));
const active = computed(() => activeIndex(lines.value, player.state.currentTime));
const dur = computed(() => player.state.duration);
const curTime = computed(() => player.state.currentTime);
const repeatKey = computed(() => ({ off: 'player.repeat', all: 'player.repeatAll', one: 'player.repeatOne' }[player.state.repeat]));

const bg = ref('radial-gradient(120% 100% at 50% 0%, rgba(120,140,130,0.30), transparent 70%), linear-gradient(180deg, rgba(28,28,26,0.9), rgba(10,10,10,0.97))');

watch(coverUrl, async (src) => {
  if (!src) return;
  try {
    const { r, g, b } = await sampleImage(src);
    bg.value = `radial-gradient(120% 100% at 50% 0%, rgba(${r},${g},${b},0.55), transparent 70%), linear-gradient(180deg, rgba(${r},${g},${b},0.45), rgba(10,10,10,0.97))`;
  } catch { /* keep default */ }
}, { immediate: true });

function sampleImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 48; c.height = 48;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 48, 48);
        const d = ctx.getImageData(0, 0, 48, 48).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        resolve({ r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) });
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = src;
  });
}

function scrollToActive() {
  if (!scrollRef.value) return;
  const idx = active.value;
  if (idx < 0) return;
  nextTick(() => {
    const el = scrollRef.value.children[idx];
    if (!el) return;
    const c = scrollRef.value;
    const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
    c.scrollTo({ top, behavior: 'smooth' });
  });
}

watch(active, scrollToActive);
// 打开全屏页时定位到当前行（否则会停在歌词开头）
watch(() => player.state.expanded, (v) => { if (v) scrollToActive(); });

function fmt(s) {
  if (!s || s < 0) return '0:00';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function onSeek(e) { player.seek(Number(e.target.value)); }
function seekTo(time) { player.seek(time); }
function close() { player.expand(false); }
</script>

<style scoped>
.np { position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; padding: 30px 44px; transition: background 0.5s ease; }
.np-enter-active, .np-leave-active { transition: opacity 0.28s ease; }
.np-enter-from, .np-leave-to { opacity: 0; }

.np-close { position: absolute; top: 22px; left: 26px; width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,0.16); color: #fff; display: grid; place-items: center; backdrop-filter: blur(8px); }
.np-close:hover { background: rgba(255,255,255,0.28); }

.np-body { flex: 1; min-height: 0; display: flex; align-items: center; gap: 48px; }

.np-left { flex: 0 0 360px; max-width: 380px; min-height: 0; display: flex; flex-direction: column; justify-content: center; overflow-y: auto; }
.np-art { width: min(340px, 36vh); height: min(340px, 36vh); min-height: 180px; border-radius: 16px; overflow: hidden; background: rgba(0,0,0,0.4); display: grid; place-items: center; color: rgba(255,255,255,0.6); box-shadow: 0 18px 50px rgba(0,0,0,0.5); align-self: center; }
.np-art img { width: 100%; height: 100%; object-fit: cover; }
/* 歌曲名：Display 34/600/-0.4（V3 字体层级最高档） */
.np-title { margin-top: 24px; font-size: 34px; line-height: 42px; font-weight: 600; letter-spacing: -0.4px; color: #fff; }
.np-artist { margin-top: 8px; font-size: 15px; line-height: 22px; letter-spacing: -0.1px; color: rgba(255,255,255,0.78); }

.np-time-row { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.np-time { font-size: 12px; color: rgba(255,255,255,0.72); font-variant-numeric: tabular-nums; min-width: 38px; text-align: center; }
.np-range { flex: 1; accent-color: rgba(255,255,255,0.92); height: 3px; }

.np-ctl-row { display: flex; align-items: center; justify-content: center; gap: 22px; margin-top: 20px; }
.np-ctl { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: rgba(255,255,255,0.86); position: relative; background: transparent; }
.np-ctl:hover { color: #fff; background: rgba(255,255,255,0.1); }
.np-ctl.on { color: #fff; }
.np-ctl-lg { width: 50px; height: 50px; }
.np-play { width: 68px; height: 68px; border-radius: 50%; background: rgba(255,255,255,0.94); color: #111; display: grid; place-items: center; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
.np-play:hover { background: #fff; }
.np-r1 { position: absolute; top: 3px; right: 3px; font-size: 10px; font-weight: 600; color: #fff; }

.np-vol { display: flex; align-items: center; gap: 12px; margin-top: 16px; color: rgba(255,255,255,0.74); }
.np-vol input { flex: 1; accent-color: rgba(255,255,255,0.9); }

.np-right { flex: 1; min-width: 0; display: flex; align-items: center; height: 100%; }
.np-lyrics { width: 100%; height: 100%; overflow-y: auto; padding: 45vh 10px 45vh 0; scroll-behavior: smooth; -webkit-mask-image: linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent); mask-image: linear-gradient(180deg, transparent, #000 15%, #000 85%, transparent); }
/* 歌词行：Title 2 20/600 → 激活 Title 1 24/600（映射 V3 字体层级） */
.np-line { padding: 9px 0; font-size: 20px; line-height: 1.5; font-weight: 600; letter-spacing: -0.2px; color: rgba(255,255,255,0.5); transition: color 0.3s ease, transform 0.3s ease; cursor: pointer; }
.np-line.active { color: #fff; font-size: 24px; }
.np-empty { text-align: center; color: rgba(255,255,255,0.55); font-size: 15px; position: sticky; top: 50%; }
</style>
