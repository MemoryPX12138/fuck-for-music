// LRC 歌词解析：返回按时间排序的 [{time, text}]
export function parseLrc(text) {
  if (!text) return [];
  const lines = [];
  const timeRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of String(text).split(/\r?\n/)) {
    const times = [];
    let m;
    timeRe.lastIndex = 0;
    while ((m = timeRe.exec(raw))) times.push(m);
    if (!times.length) continue;
    const content = raw.replace(timeRe, '').replace(/^\s+|\s+$/g, '');
    for (const tm of times) {
      const min = parseInt(tm[1], 10) || 0;
      const sec = parseInt(tm[2], 10) || 0;
      const frac = (tm[3] || '0').padEnd(3, '0').slice(0, 3);
      const ms = parseInt(frac, 10) || 0;
      lines.push({ time: min * 60 + sec + ms / 1000, text: content });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

// 给定当前时间，返回当前应该高亮的行索引
export function activeIndex(lines, time) {
  if (!lines.length) return -1;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= time + 0.01) idx = i;
    else break;
  }
  return idx;
}
