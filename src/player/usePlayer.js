// 播放器单例 composable：队列 + 播放控制 + <audio> 事件绑定
import { reactive } from 'vue';
import { t } from '../i18n';

let audio = null;
let metaToken = 0; // 用于丢弃快速切歌时过期的元数据结果

const state = reactive({
  queue: [],      // { path, name, ext, url, prepared, status }
  current: -1,
  playing: false,
  status: 'idle', // idle | loading | decoding | playing | error
  duration: 0,
  currentTime: 0,
  volume: 1,
  expanded: false, // 全屏 Now Playing / 歌词页
  error: '',
  shuffle: false,
  repeat: 'off',   // off | all | one
  trackMeta: null, // { title, artist, album, coverUrl, lrc }
});

function ensureAudio() {
  if (audio) return;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = state.volume;
  audio.addEventListener('timeupdate', () => { state.currentTime = audio.currentTime || 0; });
  audio.addEventListener('durationchange', () => { state.duration = audio.duration || 0; });
  audio.addEventListener('play', () => { state.playing = true; state.status = 'playing'; });
  audio.addEventListener('pause', () => { state.playing = false; });
  audio.addEventListener('ended', () => { onEnded(); });
  audio.addEventListener('error', () => {
    state.status = 'error';
    state.error = t('player.unsupported');
    state.playing = false;
  });
}

async function prepare(item) {
  if (item.prepared) return item;
  if (state.status !== 'decoding') state.status = 'decoding';
  const r = await window.fmf.audioPrepare(item.path);
  if (r && r.ok) { item.url = r.url; item.prepared = true; }
  else { item.error = r?.message || t('player.unsupported'); }
  return item;
}

function baseName(p) {
  const name = p.split(/[\\/]/).pop();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return { name, ext };
}

function pushItem(p) {
  const { name, ext } = baseName(p);
  state.queue.push({ path: p, name, ext, url: '', prepared: false, status: 'none' });
  return state.queue.length - 1;
}

async function load(i) {
  if (i < 0 || i >= state.queue.length) return;
  state.current = i;
  state.status = 'loading';
  state.error = '';
  state.trackMeta = null;
  ensureAudio();
  const it = state.queue[i];
  it.status = 'loading';
  try {
    const p = await prepare(it);
    if (!p.url) {
      state.status = 'error';
      state.error = p.error || t('player.unsupported');
      it.status = 'error';
      return;
    }
    audio.src = p.url;
    it.url = p.url;
    it.status = 'playing';
    await audio.play();
    state.status = 'playing';
    fetchMeta(i);
  } catch (e) {
    state.status = 'error';
    state.error = String(e?.message || e);
    it.status = 'error';
  }
}

async function fetchMeta(i) {
  if (i !== state.current) return;
  const token = ++metaToken;
  try {
    const p = state.queue[i];
    const meta = await window.fmf.metadataGet(p.path);
    if (token !== metaToken || i !== state.current) return; // 已切歌，丢弃过期结果
    if (meta && !meta.error) {
      state.trackMeta = meta;
      state.queue[i].name = meta.title || p.name;
      state.queue[i].artist = meta.artist || '';
    }
  } catch { /* 忽略抓取失败 */ }
}

function enqueue(paths) {
  let added = 0;
  for (const p of paths) {
    if (state.queue.some((q) => q.path === p)) continue;
    pushItem(p);
    added++;
  }
  if (state.current === -1 && added) load(0);
  return added;
}

// 播放指定文件：已在队列则直接切到它，否则加入并立即播放
function playPath(p) {
  const idx = state.queue.findIndex((q) => q.path === p);
  const i = idx >= 0 ? idx : pushItem(p);
  if (idx < 0 && state.current === -1) { load(i); return; }
  if (i !== state.current) load(i);
  else { ensureAudio(); audio?.play(); }
}

function play() {
  if (state.current === -1) { if (state.queue.length) load(0); return; }
  ensureAudio();
  audio?.play();
}
function pause() { audio?.pause(); }
function toggle() { audio ? (state.playing ? pause() : audio.play()) : play(); }

function onEnded() {
  if (state.repeat === 'one') { if (audio) { audio.currentTime = 0; audio.play(); } return; }
  if (state.repeat === 'off' && state.current === state.queue.length - 1) {
    // 自然播完且非循环：停在末尾
    state.playing = false;
    state.status = 'idle';
    if (audio) audio.currentTime = 0;
    return;
  }
  next();
}

function next() {
  if (!state.queue.length) return;
  let i;
  if (state.shuffle && state.queue.length > 1) {
    do { i = Math.floor(Math.random() * state.queue.length); } while (i === state.current);
  } else {
    i = (state.current + 1) % state.queue.length;
  }
  load(i);
}
function prev() {
  if (!state.queue.length) return;
  // 播放超过 3 秒则回到开头，否则上一首（Apple 行为）
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  load((state.current - 1 + state.queue.length) % state.queue.length);
}

function toggleShuffle() { state.shuffle = !state.shuffle; }
function cycleRepeat() { state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'; }

function seek(t) {
  if (audio) { audio.currentTime = t; state.currentTime = t; }
}
function setVolume(v) {
  state.volume = v;
  if (audio) audio.volume = v;
}
function expand(v) { state.expanded = v; }

export function usePlayer() {
  return { state, enqueue, playPath, play, pause, toggle, next, prev, seek, setVolume, expand, load, toggleShuffle, cycleRepeat };
}
