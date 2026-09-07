// WebDAV 上传引擎（V3.1.0）：秒传 + 断点续传 + 原子收尾
//
// 设计要点：
// 1. 秒传：skipExisting 开启时，远端同名且【大小一致】才跳过（V3.0.0 及之前仅判断存在，
//    会误跳「同名但内容不同」的文件）；大小不一致则照常重传覆盖。
// 2. 断点续传：所有上传先写到临时文件 `<原名>.<原始后缀>.fmfpart`，完整后一次性 MOVE 成
//    正式名——正式文件名下永远不会出现半截文件。重试/重跑时按远端临时文件已收到的大小续传：
//    a) 库内置探测（webdav 库 partialUpdateFileContents：SabreDAV PATCH / Apache Content-Range）
//    b) 通用 `PUT + Content-Range` 追加（部分服务器支持）
//    每种策略都以「远端临时文件大小 === 本地大小」校验是否真正生效，未生效则全量覆盖重传。
// 3. 收尾回退链：MOVE → COPY(+删临时) → 直接 PUT 到正式名（放弃原子性换正确性）。
// 4. 大文件流式上传（createReadStream），不再整文件读入内存。
// 5. 每个文件独立重试 retries 次（含退避），失败后保留远端临时文件供下次续传。
//
// 本模块为纯 Node 实现（不依赖 Electron），可被 tools/test-webdav-upload.mjs 直接单测。

import fs from 'node:fs';
import path from 'node:path';

const PART_SUFFIX = '.fmfpart';

/** 远端 stat：不存在/出错返回 null（续传能力降级，不阻断上传主流程） */
async function statOrNull(client, p) {
  try {
    const st = await client.stat(p);
    return st && typeof st.size === 'number' ? st : null;
  } catch {
    return null;
  }
}

/** 读取本地文件 [start, EOF) 的尾部缓冲（续传只需发送剩余字节） */
async function readTail(filePath, start) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const total = (await fh.stat()).size;
    const len = Math.max(0, total - start);
    const buf = Buffer.alloc(len);
    if (len > 0) await fh.read(buf, 0, len, start);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * 尝试向远端临时文件追加剩余字节（断点续传核心）。
 * 两种策略依次尝试，均以远端大小校验收敛；失败返回 false，由调用方全量覆盖。
 */
async function tryAppend(client, tempPath, localPath, remoteDone, localSize) {
  let tail = null;
  // 策略 a：webdav 库内置追加（先 OPTIONS 探测兼容性；SabreDAV PATCH / Apache Content-Range）
  try {
    if (!tail) tail = await readTail(localPath, remoteDone);
    await client.partialUpdateFileContents(tempPath, remoteDone, localSize - 1, tail);
    if ((await statOrNull(client, tempPath))?.size === localSize) return true;
  } catch { /* 不支持或未生效，继续 */ }
  // 策略 b：通用 PUT + Content-Range（接受即追加；忽略则写入后大小校验不通过 → 回退全量）
  try {
    if (!tail) tail = await readTail(localPath, remoteDone);
    await client.putFileContents(tempPath, tail, {
      overwrite: true,
      headers: { 'Content-Range': `bytes ${remoteDone}-${localSize - 1}/${localSize}` },
    });
    if ((await statOrNull(client, tempPath))?.size === localSize) return true;
  } catch { /* 不支持，回退全量 */ }
  return false;
}

/** 收尾：临时文件 → 正式文件。MOVE → COPY(+删临时) → 直接 PUT 三级回退 */
async function finalize(client, tempPath, finalPath, localPath) {
  try { await client.moveFile(tempPath, finalPath, { overwrite: true }); return 'move'; } catch { /* 尝试下一级 */ }
  try {
    await client.copyFile(tempPath, finalPath, { overwrite: true });
    try { await client.deleteFile(tempPath); } catch { /* 残留无害 */ }
    return 'copy';
  } catch { /* 尝试最后一级 */ }
  // 兜底：某些服务器限制 MOVE/COPY，直接把完整文件 PUT 到正式路径
  await client.putFileContents(finalPath, fs.createReadStream(localPath), { overwrite: true });
  try { await client.deleteFile(tempPath); } catch { /* 残留无害 */ }
  return 'put';
}

/**
 * 批量上传。
 * @param {object} opts
 * @param {object} opts.client        webdav 客户端（createClient 产物）
 * @param {string} opts.remoteDir     远端目标目录（'/' 或 '/a/b'）
 * @param {string[]} opts.files       本地文件绝对路径列表
 * @param {number} [opts.concurrency] 并发数（1-8，默认 3）
 * @param {boolean} [opts.skipExisting] 远端同名且大小一致时跳过（秒传）
 * @param {number} [opts.retries]     每个文件的总尝试次数（默认 3）
 * @param {Function} [opts.send]      进度回调（queued/start/file/done 事件）
 * @returns {Promise<{total:number, success:number, fail:number, skipped:number, resumed:number, results:Array}>}
 */
export async function uploadFiles({
  client,
  remoteDir = '/',
  files = [],
  concurrency = 3,
  skipExisting = false,
  retries = 3,
  send = () => {},
}) {
  const base = String(remoteDir || '/').replace(/\/+$/, '');
  const total = files.length;
  let idx = 0, success = 0, fail = 0, skipped = 0, resumedCount = 0, finishedCount = 0;
  const results = [];

  send({ type: 'queued', total, remoteDir });

  const uploadOne = async (i, localPath) => {
    const name = path.basename(localPath);
    const finalPath = base + '/' + name;
    const tempPath = finalPath + PART_SUFFIX;
    let localSize = 0;
    try { localSize = (await fs.promises.stat(localPath)).size; } catch { /* 读取失败按 0 处理，上传时报错 */ }

    // 秒传：远端同名文件大小与本地一致才跳过
    if (skipExisting) {
      const st = await statOrNull(client, finalPath);
      if (st && localSize > 0 && st.size === localSize) {
        skipped++;
        results.push({ name, ok: true, skipped: true, instant: true });
        send({ type: 'file', index: i, name, sent: localSize, size: localSize, instant: true });
        send({ type: 'done', index: i, total, name, finished: ++finishedCount, success, fail, skipped });
        return;
      }
    }

    let resumed = false;
    let lastErr = null;
    const attempts = Math.max(1, retries);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const tempSt = await statOrNull(client, tempPath);
        const remoteDone = tempSt ? tempSt.size : 0;

        if (localSize > 0 && remoteDone === localSize) {
          // 上次已完整写入临时文件（中断发生在改名前）→ 跳过传输直接收尾
          if (attempt > 1) resumed = true;
        } else if (localSize > 0 && remoteDone > 0 && remoteDone < localSize) {
          // 断点续传：按远端已收到的字节数追加剩余部分
          send({ type: 'file', index: i, name, sent: remoteDone, size: localSize, resumed: true });
          if (await tryAppend(client, tempPath, localPath, remoteDone, localSize)) {
            resumed = true;
          } else {
            // 服务器不支持追加或追加未生效 → 流式全量覆盖临时文件
            await client.putFileContents(tempPath, fs.createReadStream(localPath), { overwrite: true });
          }
        } else {
          // 常规全量上传（临时文件不存在/为空/比本地还大）→ 流式 PUT
          await client.putFileContents(tempPath, fs.createReadStream(localPath), { overwrite: true });
        }
        send({ type: 'file', index: i, name, sent: localSize, size: localSize, resumed });

        await finalize(client, tempPath, finalPath, localPath);
        success++;
        if (resumed) resumedCount++;
        results.push({ name, ok: true, ...(resumed ? { resumed: true } : {}) });
        send({ type: 'done', index: i, total, name, finished: ++finishedCount, success, fail, skipped });
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < attempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt)); // 退避后重试（临时文件仍可续传）
        }
      }
    }
    fail++;
    results.push({ name, ok: false, message: String(lastErr?.message || lastErr) });
    // 失败后保留远端临时文件，供下次重跑续传
  };

  const worker = async () => {
    while (idx < total) {
      const i = idx++;
      const f = files[i];
      send({ type: 'start', index: i, total, name: path.basename(f) });
      await uploadOne(i, f);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, () => worker()));
  } catch (e) {
    return { total, success, fail, skipped, resumed: resumedCount, results, error: String(e?.message || e) };
  }
  return { total, success, fail, skipped, resumed: resumedCount, results };
}
