// 元数据 + 歌词抓取：本地标签优先，在线（某云 API → lrclib）补充
import { parseFile } from 'music-metadata';

const REQ_TIMEOUT = 8000; // ms

async function fetchJ(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

// 取图片字节转成 data URL，避免协议相对路径/CORS 污染，前端可直接显示并做背景取色
async function imgToDataUrl(url) {
  let ac, t;
  try {
    ac = new AbortController();
    t = setTimeout(() => ac.abort(), REQ_TIMEOUT);
    const res = await fetch(url, { signal: ac.signal, headers: { Referer: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0] || 'image/jpeg';
    if (!/^image\//.test(ct)) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 1024 * 1024) return ''; // 封面限 1MB
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch { return ''; }
  finally { clearTimeout(t); }
}

// 读本地标签（title/artist/album/封面，不读整段时长以免阻塞）
export async function readLocalTags(filePath) {
  try {
    const meta = await parseFile(filePath, { duration: false });
    const common = meta.common;
    const pic = Array.isArray(common.picture) ? common.picture[0] : null;
    let coverUrl = '';
    // 封面 base64 过长会撞 Chromium URL 上限 -> 跳过内嵌大封面，交给在线补
    if (pic && pic.data && pic.data.length < 600 * 1024) {
      coverUrl = `data:${pic.format || 'image/jpeg'};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
    return {
      title: common.title || '',
      artist: common.artist || (common.artists && common.artists[0]) || '',
      album: common.album || '',
      coverUrl,
      duration: meta.format.duration || 0,
      lrc: '',
    };
  } catch (e) {
    return { title: '', artist: '', album: '', coverUrl: '', duration: 0, lrc: '' };
  }
}

// 文件名启发：优先 "Artist - Title"
export function nameHints(filePath) {
  const base = filePath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').trim();
  const m = base.match(/^(.+?)\s+[–—\-]\s+(.+)$/);
  if (m) return { title: m[2].trim(), artist: m[1].trim() };
  return { title: base.replace(/[_-]+/g, ' ').trim(), artist: '' };
}

// —— 某云 API（非官方，可能失败，保守处理）——
async function netease(keyword, title, artist) {
  try {
    const body = new URLSearchParams({ s: keyword, type: '1', limit: '6', offset: '0' });
    const data = await fetchJ('https://music.163.com/api/search/get', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://music.163.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      body: body.toString(),
    });
    const songs = data?.result?.songs || [];
    if (!songs.length) return null;
    // 简单匹配 title
    const kw = (title || '').replace(/\s+/g, '').toLowerCase();
    let song = songs.find((s) => kw && (s.name || '').replace(/\s+/g, '').toLowerCase() === kw) || songs[0];
    const id = song.id;
    let lrc = '';
    try {
      const lyric = await fetchJ(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`);
      lrc = lyric?.lrc?.lyric || '';
    } catch { /* ignore */ }
    let coverUrl = '';
    try {
      // 注意 ids 需带方括号，否则 album 取不到
      const detail = await fetchJ(`https://music.163.com/api/song/detail?ids=[${id}]`);
      const pic = detail?.songs?.[0]?.album?.picUrl || '';
      if (pic) {
        const https = pic.startsWith('//') ? 'https:' + pic : pic.replace(/^http:/, 'https:');
        coverUrl = await imgToDataUrl(https + '?param=500y500');
      }
    } catch { /* ignore */ }
    return { title: song.name || title, artist: (song.artists && song.artists[0]?.name) || artist, album: song.album?.name || '', coverUrl, lrc };
  } catch (e) {
    return null;
  }
}

// —— lrclib（开源、免鉴权、提供同步歌词）——
async function lrclib(title, artist) {
  try {
    const params = new URLSearchParams({ track_name: title || '', artist_name: artist || '' });
    const data = await fetchJ(`https://lrclib.net/api/get?${params.toString()}`);
    if (!data?.syncedLyrics && !data?.plainLyrics) return null;
    return {
      title: data.trackName || title,
      artist: data.artistName || artist,
      album: data.albumName || '',
      lrc: data.syncedLyrics || data.plainLyrics || '',
      coverUrl: '',
    };
  } catch (e) {
    return null;
  }
}

// 主入口：metadata:get
export async function metadataGet(filePath) {
  const local = await readLocalTags(filePath);
  const out = { title: local.title, artist: local.artist, album: local.album, coverUrl: local.coverUrl, duration: local.duration, lrc: '' };
  if (!out.title) { const h = nameHints(filePath); if (!out.title) out.title = h.title; if (!out.artist) out.artist = h.artist; }
  if (!out.title) return out;

  let net = null, lr = null;
  try { net = await netease(`${out.title} ${out.artist}`.trim(), out.title, out.artist); } catch { net = null; }
  if (net) {
    if (net.lrc) out.lrc = net.lrc;
    if (!out.coverUrl && net.coverUrl) out.coverUrl = net.coverUrl;
    if (!out.album && net.album) out.album = net.album;
  }
  // 歌词缺失时再走 lrclib 兜底（不因某云命中而短路）
  if (!out.lrc) {
    try { lr = await lrclib(out.title, out.artist); } catch { lr = null; }
    if (lr) { if (lr.lrc) out.lrc = lr.lrc; if (!out.album && lr.album) out.album = lr.album; }
  }
  return out;
}
