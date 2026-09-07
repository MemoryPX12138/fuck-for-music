// 解密内核 —— 移植自 unlock-music v1.10.4（MIT License, github.com/ix64/unlock-music）
// QMC/KGM 走 @xhacker wasm；其余格式为纯 JS 移植实现。
import crypto from 'node:crypto';
import { XM_X2M_TABLE, XM_X3M_TABLE } from './tables.mjs';

const CHUNK = 2097152; // 2MB，与原版 wasm 分块一致

// 扩展名分发表：输入扩展名 -> 目标扩展名（与原版 worker 中的 map B 一致）
export const EXT_MAP = {
  mgg: 'ogg', mgg0: 'ogg', mggl: 'ogg', mgg1: 'ogg',
  mflac: 'flac', mflac0: 'flac',
  mmp4: 'mp4',
  qmcflac: 'flac', qmcogg: 'ogg',
  qmc0: 'mp3', qmc2: 'ogg', qmc3: 'mp3', qmc4: 'ogg', qmc6: 'ogg', qmc8: 'ogg',
  bkcmp3: 'mp3', bkcm4a: 'm4a', bkcflac: 'flac', bkcwav: 'wav', bkcape: 'ape', bkcogg: 'ogg', bkcwma: 'wma',
  tkm: 'm4a',
  '666c6163': 'flac', '6d7033': 'mp3', '6f6767': 'ogg', '6d3461': 'm4a', '776176': 'wav',
};

// 文件选择器支持的扩展名（mflach 网页版本身不支持，同样排除）
export const SUPPORT_EXTS = [
  ...Object.keys(EXT_MAP),
  'tm0', 'tm2', 'tm3', 'tm6', 'cache',
  'ncm', 'uc', 'kwm', 'xm', 'x2m', 'x3m', 'vpr', 'kgm', 'kgma', 'mg3d',
];

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

// ---------- 音频魔数嗅探 ----------
export function sniffExt(buf) {
  if (buf.length < 12) return '';
  const ascii = (o, s) => buf.slice(o, o + s.length).toString('latin1') === s;
  if (ascii(0, 'fLaC')) return 'flac';
  if (ascii(0, 'OggS')) return 'ogg';
  if (ascii(0, 'ID3')) return 'mp3';
  if (ascii(4, 'ftyp')) return 'm4a';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'wav';
  if (ascii(0, 'MAC ')) return 'ape';
  if (buf[0] === 0x30 && ascii(4, 'FMOD')) return 'wav'; // 某些 ape 变体
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  if (ascii(0, 'wvpk')) return 'wv';
  return '';
}

const MIME = {
  mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4',
  wav: 'audio/wav', ape: 'audio/ape', wma: 'audio/x-ms-wma', wv: 'audio/x-wavpack', mp4: 'video/mp4',
};

// ---------- QMC（mflac/mgg/qmc*/bkc* 等，wasm）----------
let qmcMod = null, kgmMod = null;
async function getQmc() {
  if (!qmcMod) qmcMod = await (await import('@xhacker/qmcwasm/QmcWasmBundle.js')).default();
  return qmcMod;
}
async function getKgm() {
  if (!kgmMod) kgmMod = await (await import('@xhacker/kgmwasm/KgmWasmBundle.js')).default();
  return kgmMod;
}

// 协议与原版 worker 中 E() 完全一致：尾部 2MB 预解 -> 逐块 decBlob -> 拼接
export async function decryptQMC(buf, ext) {
  const m = await getQmc();
  const ptr = m._malloc(CHUNK);
  try {
    m.writeArrayToMemory(buf.slice(-CHUNK), ptr);
    const footerLen = m.preDec(ptr, CHUNK, '.' + ext);
    if (footerLen === -1) throw new Error(m.getErr() || 'QMC 预解密失败（可能是不支持的缓存格式）');
    const total = buf.length - footerLen;
    const parts = [];
    let offset = 0, remain = total;
    while (remain > 0) {
      const len = Math.min(remain, CHUNK);
      m.writeArrayToMemory(buf.slice(offset, offset + len), ptr);
      const decLen = m.decBlob(ptr, len, offset);
      parts.push(m.HEAPU8.slice(ptr, ptr + decLen));
      offset += len; remain -= len;
    }
    let data = concat(parts);
    return data;
  } finally {
    m._free(ptr);
  }
}

// 协议与原版 worker 中 k() 完全一致：头部 2MB 预解得到头部偏移 -> 跳过 -> 逐块解密
export async function decryptKGM(buf, ext) {
  const m = await getKgm();
  const ptr = m._malloc(CHUNK);
  try {
    m.writeArrayToMemory(buf.slice(0, CHUNK), ptr);
    const headerLen = m.preDec(ptr, CHUNK, ext);
    const body = buf.slice(headerLen);
    const parts = [];
    let offset = 0, remain = body.length;
    while (remain > 0) {
      const len = Math.min(remain, CHUNK);
      m.writeArrayToMemory(body.slice(offset, offset + len), ptr);
      m.decBlob(ptr, len, offset);
      parts.push(m.HEAPU8.slice(ptr, ptr + len));
      offset += len; remain -= len;
    }
    return concat(parts);
  } finally {
    m._free(ptr);
  }
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const eqBytes = (buf, arr) => arr.every((v, i) => buf[i] === v);
const VPR_MAGIC = [5, 40, 188, 150, 233, 228, 90, 67, 145, 170, 189, 208, 122, 245, 54, 49];
const KGM_MAGIC = [124, 213, 50, 235, 134, 2, 127, 75, 168, 175, 166, 142, 15, 255, 153, 20];

export async function decryptVprKgm(buf, ext) {
  if (ext === 'vpr') {
    if (!eqBytes(buf, VPR_MAGIC)) throw new Error('不是有效的 vpr 文件');
  } else if (!eqBytes(buf, KGM_MAGIC)) {
    throw new Error('不是有效的 kgm(a) 文件');
  }
  return decryptKGM(buf, ext);
}

// ---------- NCM----------
const NCM_MAGIC = [67, 84, 69, 78, 70, 68, 65, 77]; // CTENFDAM
const NCM_CORE_KEY = Buffer.from('687A4852416D736F356B496E62617857', 'hex');
const NCM_META_KEY = Buffer.from('2331346C6A6B5F215C5D2630553C2728', 'hex');

export function decryptNCM(buf) {
  if (!eqBytes(buf, NCM_MAGIC)) throw new Error('此 ncm 文件已损坏');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 10;
  // 密钥
  const keyLen = view.getUint32(offset, true); offset += 4;
  const keyData = Buffer.from(buf.slice(offset, offset + keyLen)); offset += keyLen;
  for (let i = 0; i < keyData.length; i++) keyData[i] ^= 0x64;
  const d = crypto.createDecipheriv('aes-128-ecb', NCM_CORE_KEY, null);
  d.setAutoPadding(false);
  const decrypted = Buffer.concat([d.update(keyData), d.final()]);
  const keyBoxSrc = decrypted.slice(17);
  const n = keyBoxSrc.length;
  const sbox = Uint8Array.from(Array(256).keys());
  let j = 0;
  for (let i = 0, swap; i < 256; i++) {
    j = (sbox[i] + j + keyBoxSrc[i % n]) & 255;
    swap = [sbox[j], sbox[i]]; sbox[i] = swap[0]; sbox[j] = swap[1];
  }
  const keyBox = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) {
    const a = (i + 1) & 255, b = sbox[a], c = sbox[(a + b) & 255];
    keyBox[i] = sbox[(b + c) & 255];
  }
  // 元数据（仅用于跳过，不解析内容）
  const metaLen = view.getUint32(offset, true); offset += 4;
  if (metaLen > 0) offset += metaLen;
  // crc(4) + 1字节间隔 + 图片大小(4) + 4字节间隔 + 图片数据
  const imgLen = view.getUint32(offset + 5, true);
  offset += imgLen + 13;
  // 音频流
  const audio = buf.slice(offset);
  for (let i = 0; i < audio.length; i++) audio[i] ^= keyBox[i & 255];
  const ext = sniffExt(audio);
  if (!ext) throw new Error('ncm 解密失败：无法识别音频格式');
  return { data: audio, ext };
}

// ---------- KWM----------
const KWM_MAGIC_A = [121, 101, 101, 108, 105, 111, 110, 45, 107, 117, 119, 111, 45, 116, 109, 101]; // yeelion-kuwo-tme
const KWM_MAGIC_B = [121, 101, 101, 108, 105, 111, 110, 45, 107, 117, 119, 111, 0, 0, 0, 0];       // yeelion-kuwo
const KWM_MASK = 'MoOtOiTvINGwd2E6n0E1i7L5t2IoOoNk';

export function decryptKWM(buf) {
  if (!eqBytes(buf, KWM_MAGIC_A) && !eqBytes(buf, KWM_MAGIC_B)) {
    const sniffed = sniffExt(buf);
    if (sniffed === 'aac' || sniffed === 'mp3' || sniffed === 'flac' || sniffed === 'ogg' || sniffed === 'm4a') {
      return { data: buf, ext: sniffed === 'aac' ? 'm4a' : sniffed }; // 未加密的裸流
    }
    throw new Error('不是有效的 kwm 文件');
  }
  const seg = buf.slice(24, 32);
  const num = new DataView(seg.buffer, seg.byteOffset, seg.byteLength).getBigUint64(0, true).toString();
  let str = num;
  if (str.length > 32) str = str.slice(0, 32);
  else if (str.length < 32) str = str.padEnd(32, str);
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key[i] = KWM_MASK.charCodeAt(i) ^ str.charCodeAt(i);
  const audio = buf.slice(1024);
  for (let i = 0; i < audio.length; i++) audio[i] ^= key[i % 32];
  const ext = sniffExt(audio);
  if (!ext) throw new Error('kwm 解密失败：无法识别音频格式');
  return { data: audio, ext };
}

// ---------- XM----------
const XM_MAGIC = [105, 102, 109, 116];      // ifmt
const XM_MAGIC2 = [254, 254, 254, 254];
const XM_TYPES = { ' WAV': 'wav', FLAC: 'flac', ' MP3': 'mp3', ' A4M': 'm4a' };

export function decryptXM(buf, ext) {
  if (!eqBytes(buf, XM_MAGIC) || !eqBytes(buf.slice(8, 12), XM_MAGIC2)) {
    // 已解密的裸流：按嗅探结果改名保存（嗅探失败则保留原扩展名）
    if (ext === 'xm') throw new Error('此 xm 文件已损坏');
    return { data: buf, ext: sniffExt(buf) || ext };
  }
  const type = buf.slice(4, 8).toString('latin1');
  const target = XM_TYPES[type];
  if (!target) throw new Error('未知的 .xm 文件类型');
  const seed = buf[15];
  const start = buf[12] | (buf[13] << 8) | (buf[14] << 16);
  const audio = buf.slice(16);
  for (let m = start; m < audio.length; m++) audio[m] = (audio[m] - seed) ^ 255;
  return { data: audio, ext: target };
}

// ---------- UC（UC 霸王龙）----------
export function decryptUC(buf) {
  const audio = buf.slice();
  for (let i = 0; i < audio.length; i++) audio[i] ^= 163; // 0xA3
  const ext = sniffExt(audio);
  if (!ext) throw new Error('uc 解密失败：无法识别音频格式');
  return { data: audio, ext };
}

// ---------- x2m / x3m----------
export function decryptX2M(buf) {
  const head = buf.slice(0, 1024);
  for (let n = 0; n < 1024; n++) buf[n] = head[XM_X2M_TABLE[n]] ^ [120, 109, 108, 121][n % 4]; // "xmly"
  return { data: buf, ext: 'm4a' };
}
export function decryptX3M(buf) {
  const key = [51, 57, 56, 57, 100, 49, 49, 49, 97, 97, 100, 53, 54, 49, 51, 57, 52, 48, 102, 52, 102, 99, 52, 52, 98, 54, 51, 57, 98, 50, 57, 50];
  const head = buf.slice(0, 1024);
  for (let n = 0; n < 1024; n++) buf[n] = head[XM_X3M_TABLE[n]] ^ key[n % 32];
  return { data: buf, ext: 'm4a' };
}

// ---------- mg3d（某 Q 系客户端的高效压缩缓存）----------
function isHexChar(b) { return (b >= 48 && b <= 57) || (b >= 65 && b <= 70); }
function isPrintable(b) { return b >= 32 && b <= 126; }

export function decryptMG3D(buf) {
  const head = buf.slice(0, 256);
  const keys = [];
  for (let p = 32; p < 20 * 32; p += 32) {
    const chunk = buf.slice(p, p + 32);
    if (!chunk.every(isHexChar)) continue;
    const probe = Buffer.from(head); // probe[i] -= chunk[i%32]
    for (let i = 0; i < probe.length; i++) probe[i] -= chunk[i % 32];
    if (probe.slice(0, 4).toString('latin1') !== 'RIFF') continue;
    if (probe.slice(8, 16).toString('latin1') !== 'WAVEfmt ') continue;
    const fmtLen = probe.readUInt32LE(16);
    if (![16, 18, 40].includes(fmtLen)) continue;
    const e = 20 + fmtLen;
    const y = probe.slice(e, e + 4);
    if (!y.every(isPrintable)) continue;
    const b = e + 8 + probe.readUInt32LE(e + 4);
    if (b > probe.length) continue;
    const v = probe.slice(b, b + 4);
    if (v.every(isPrintable)) continue;
    keys.push(chunk);
  }
  if (keys.length <= 0) throw new Error('ERROR: no suitable key discovered（mg3d 密钥探测失败）');
  const key = keys[0];
  for (let i = 0; i < buf.length; i++) buf[i] -= key[i % key.length];
  return { data: buf, ext: 'wav' };
}

// ---------- 裸流兜底（ogg/tm/cache 等仅改名的格式）----------
export function decryptRaw(buf, fallbackExt) {
  const sniffed = sniffExt(buf);
  if (!sniffed) {
    if (fallbackExt === 'cache') throw new Error('不支持的该客户端缓存格式');
    // 无法嗅探时保留原扩展名
    return { data: buf, ext: fallbackExt };
  }
  return { data: buf, ext: sniffed };
}

// ---------- 总分发 ----------
export async function decryptBuffer(buf, rawExt) {
  const ext = extOf(rawExt);
  switch (ext) {
    case 'ncm': return decryptNCM(buf);
    case 'uc': return decryptUC(buf);
    case 'kwm': return decryptKWM(buf);
    case 'xm': return decryptXM(buf, ext);
    case 'wav': case 'mp3': case 'flac': case 'm4a':
      return decryptXM(buf, ext); // 可能是已解密裸流，内部会兜底嗅探
    case 'ogg': case 'tm0': case 'tm3':
      return decryptRaw(buf, ext === 'tm0' || ext === 'tm3' ? 'mp3' : 'ogg');
    case 'tm2': case 'tm6': return decryptRaw(buf, 'm4a');
    case 'cache': return decryptRaw(buf, 'cache');
    case 'x2m': return decryptX2M(buf);
    case 'x3m': return decryptX3M(buf);
    case 'vpr': case 'kgm': case 'kgma': {
      const data = await decryptVprKgm(buf, ext);
      const sniffed = sniffExt(data);
      return { data, ext: sniffed || 'mp3' };
    }
    case 'mg3d': return decryptMG3D(buf);
    default:
      if (ext in EXT_MAP) {
        const data = await decryptQMC(buf, ext);
        const sniffed = sniffExt(data);
        return { data, ext: sniffed || EXT_MAP[ext] };
      }
      throw new Error(`不支持的格式：.${ext}`);
  }
}
