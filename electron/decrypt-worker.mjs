// 转换工作线程：每个线程独立加载 wasm 并处理一个文件
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { decryptBuffer } from './lib/decrypt.mjs';

parentPort.on('message', async (job) => {
  const { id, src, outDir } = job;
  try {
    const buf = fs.readFileSync(src);
    const { data, ext } = await decryptBuffer(buf, path.basename(src));
    const dest = uniquePath(outDir, path.basename(src, path.extname(src)), ext);
    fs.writeFileSync(dest, data);
    parentPort.postMessage({ id, ok: true, src, dest });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, src, message: err && err.message ? err.message : String(err) });
  }
});

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`);
  let n = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${n++}).${ext}`);
  return p;
}
