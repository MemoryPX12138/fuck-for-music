// WebDAV 上传引擎单测（V3.1.0）
// 运行：node tools/test-webdav-upload.mjs
// 内置一个可配置行为的 mock WebDAV 服务器，验证 electron/lib/webdavUpload.mjs 的：
//   秒传（大小校验跳过）/ 断点续传（两种追加策略 + 大小校验回退）/ 原子收尾（MOVE→COPY→PUT）
//   流式全量上传 / 逐文件重试 / 进度事件契约。
// 覆盖服务器行为矩阵：Content-Range 生效/拒绝/忽略、SabreDAV PATCH、MOVE 受限、瞬时 500。

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { createClient } from 'webdav';
import { uploadFiles } from '../electron/lib/webdavUpload.mjs';

// ────────────────────────── mock WebDAV 服务器 ──────────────────────────
/**
 * @param {object} opts
 * @param {'honor'|'reject'|'ignore'} [opts.contentRange]  PUT 带 Content-Range 时的行为
 * @param {boolean} [opts.sabrePatch] 广告 sabredav-partialupdate 并实现 PATCH（X-Update-Range）
 * @param {'allow'|'deny'} [opts.move] MOVE 方法行为
 * @param {number} [opts.failFirstFullPut] 前 N 次不带 Content-Range 的 PUT 返回 500
 */
function startMockDav({ contentRange = 'honor', sabrePatch = false, move = 'allow', failFirstFullPut = 0 } = {}) {
  const store = new Map(); // '/path' -> Buffer
  const stats = { appendOk: 0, patchOk: 0, fullPut: 0, fullPut500: 0, moves: 0, copies: 0 };

  const multistatus = (key, size) =>
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${key}</D:href>` +
    `<D:propstat><D:prop><D:displayname>${path.posix.basename(key)}</D:displayname>` +
    `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength>` +
    `<D:getlastmodified>Mon, 07 Sep 2026 09:00:00 GMT</D:getlastmodified></D:prop>` +
    `<D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;

  const writeRange = (key, body, start) => {
    const prev = store.get(key) || Buffer.alloc(0);
    if (start >= prev.length) {
      store.set(key, Buffer.concat([prev, body])); // 追加
    } else {
      const head = prev.subarray(0, start);
      const tail = prev.subarray(start + body.length);
      store.set(key, Buffer.concat([head, body, tail])); // 区间覆盖
    }
  };

  const srv = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const key = decodeURIComponent(req.url).replace(/\/+$/, '') || '/';
      const ok = (code, headers) => { res.writeHead(code, headers); res.end(); };

      switch (req.method) {
        case 'OPTIONS': {
          const dav = sabrePatch ? '1, 2, sabredav-partialupdate' : '1, 2';
          return ok(200, { DAV: dav, Allow: 'OPTIONS, GET, PUT, DELETE, PROPFIND, PROPPATCH, MOVE, COPY, PATCH, MKCOL' });
        }
        case 'PROPFIND': {
          if (!store.has(key)) return ok(404);
          res.writeHead(207, { 'Content-Type': 'application/xml' });
          res.end(multistatus(key, store.get(key).length));
          return;
        }
        case 'PUT': {
          const cr = req.headers['content-range'];
          if (cr) {
            const m = /^bytes (\d+)-(\d+)\/\d+$/.exec(cr);
            if (contentRange === 'reject') return ok(400);
            if (contentRange === 'honor' && m) {
              writeRange(key, body, Number(m[1]));
              stats.appendOk++;
              return ok(204);
            }
            // 'ignore'：假装没看到 Content-Range，直接整体覆盖（下面走普通逻辑）
          }
          if (stats.fullPut500 < failFirstFullPut) { stats.fullPut500++; stats.fullPut++; return ok(500); }
          stats.fullPut++;
          store.set(key, body);
          return ok(201);
        }
        case 'PATCH': {
          if (!sabrePatch) return ok(405);
          const xr = /^bytes=(\d+)-(\d+)$/.exec(req.headers['x-update-range'] || '');
          if (!xr) return ok(400);
          writeRange(key, body, Number(xr[1]));
          stats.patchOk++;
          return ok(204);
        }
        case 'MOVE': {
          if (move === 'deny') return ok(403);
          const dest = decodeURIComponent(new URL(req.headers.destination).pathname).replace(/\/+$/, '');
          if (!store.has(key)) return ok(404);
          if (req.headers.overwrite !== 'F' && store.has(dest)) store.delete(dest);
          store.set(dest, store.get(key));
          store.delete(key);
          stats.moves++;
          return ok(201);
        }
        case 'COPY': {
          const dest = decodeURIComponent(new URL(req.headers.destination).pathname).replace(/\/+$/, '');
          if (!store.has(key)) return ok(404);
          if (req.headers.overwrite !== 'F' && store.has(dest)) store.delete(dest);
          store.set(dest, Buffer.from(store.get(key)));
          stats.copies++;
          return ok(201);
        }
        case 'DELETE': {
          store.delete(key);
          return ok(204);
        }
        default:
          return ok(405);
      }
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    srv, store, stats,
    port: srv.address().port,
    client: createClient(`http://127.0.0.1:${srv.address().port}`, { username: 'u', password: 'p' }),
    async close() { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); },
  })));
}

// ────────────────────────── 测试工具 ──────────────────────────
let seed = 42;
function makeBuf(size) { // 确定性伪随机内容，能检出任何字节错位
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; buf[i] = seed & 0xff; }
  return buf;
}

async function withTmp(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fmf-upload-test-'));
  try { return await fn(dir); } finally { await fs.promises.rm(dir, { recursive: true, force: true }); }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ────────────────────────── 场景 ──────────────────────────

test('全量上传（流式）：3 个文件逐字节一致 + 进度事件契约', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({});
    try {
      const files = ['a.mp3', 'b.flac', 'c.mp3'].map((n) => {
        const p = path.join(dir, n);
        fs.writeFileSync(p, makeBuf(n === 'b.flac' ? 2_300_000 : n === 'a.mp3' ? 1_100_000 : 500_000));
        return p;
      });
      const events = [];
      const r = await uploadFiles({
        client: d.client, remoteDir: '/', files, concurrency: 2, skipExisting: false,
        send: (e) => events.push(e),
      });
      assert.equal(r.total, 3); assert.equal(r.success, 3); assert.equal(r.fail, 0); assert.equal(r.skipped, 0);
      for (const f of files) {
        const remote = d.store.get('/' + path.basename(f));
        assert.ok(remote, '远端应有文件');
        assert.equal(Buffer.compare(remote, fs.readFileSync(f)), 0, '远端字节应与本地一致');
      }
      assert.equal(events.filter((e) => e.type === 'queued').length, 1);
      assert.equal(events.filter((e) => e.type === 'start').length, 3);
      assert.equal(events.filter((e) => e.type === 'done').length, 3);
      assert.ok(events.every((e) => e.type !== 'done' || e.finished >= 1));
    } finally { await d.close(); }
  });
});

test('秒传：skipExisting 下远端同名同大小 → 跳过且不再传输', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({});
    try {
      const p = path.join(dir, 'same.mp3');
      const buf = makeBuf(800_000);
      fs.writeFileSync(p, buf);
      const r1 = await uploadFiles({ client: d.client, remoteDir: '/', files: [p], skipExisting: false });
      assert.equal(r1.success, 1);
      d.stats.fullPut = 0; // 重置计数，第二轮不应有新的全量 PUT
      const r2 = await uploadFiles({ client: d.client, remoteDir: '/', files: [p], skipExisting: true });
      assert.equal(r2.skipped, 1, '应按秒传跳过');
      assert.equal(r2.results[0].instant, true);
      assert.equal(d.stats.fullPut, 0, '秒传不应触发任何 PUT');
    } finally { await d.close(); }
  });
});

test('秒传修复：远端同名但大小不同 → 不误跳，照常覆盖重传', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({});
    try {
      d.store.set('/diff.mp3', Buffer.alloc(100, 1)); // 远端有同名但内容不同的文件
      const p = path.join(dir, 'diff.mp3');
      const buf = makeBuf(600_000);
      fs.writeFileSync(p, buf);
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p], skipExisting: true });
      assert.equal(r.skipped, 0, '大小不一致不得跳过');
      assert.equal(r.success, 1);
      assert.equal(d.store.get('/diff.mp3').length, buf.length);
      assert.equal(Buffer.compare(d.store.get('/diff.mp3'), buf), 0);
    } finally { await d.close(); }
  });
});

test('断点续传·策略b：Content-Range 追加生效 → 只传剩余字节，结果一致', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ contentRange: 'honor' });
    try {
      const buf = makeBuf(2_000_000);
      const p = path.join(dir, 'resume.mp3');
      fs.writeFileSync(p, buf);
      d.store.set('/resume.mp3.fmfpart', buf.subarray(0, 1_200_000)); // 模拟上次中断：已传 60%
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p], skipExisting: false });
      assert.equal(r.success, 1);
      assert.equal(r.results[0].resumed, true, '结果应标记续传');
      assert.equal(r.resumed, 1);
      assert.equal(d.stats.appendOk, 1, '应恰好发生一次追加');
      assert.equal(d.stats.fullPut, 0, '续传成功后不应全量重传');
      assert.equal(Buffer.compare(d.store.get('/resume.mp3'), buf), 0, '拼接结果应逐字节一致');
      assert.ok(!d.store.has('/resume.mp3.fmfpart'), 'MOVE 后临时文件应消失');
    } finally { await d.close(); }
  });
});

test('断点续传·策略a：SabreDAV PATCH（X-Update-Range）生效', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ sabrePatch: true, contentRange: 'reject' });
    try {
      const buf = makeBuf(1_500_000);
      const p = path.join(dir, 'sabre.flac');
      fs.writeFileSync(p, buf);
      d.store.set('/sabre.flac.fmfpart', buf.subarray(0, 600_000)); // 已传 40%
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.equal(r.results[0].resumed, true);
      assert.equal(d.stats.patchOk, 1);
      assert.equal(d.stats.fullPut, 0);
      assert.equal(Buffer.compare(d.store.get('/sabre.flac'), buf), 0);
    } finally { await d.close(); }
  });
});

test('断点续传：临时文件已完整但未改名 → 直接收尾，零传输', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ contentRange: 'honor' });
    try {
      const buf = makeBuf(900_000);
      const p = path.join(dir, 'done.mp3');
      fs.writeFileSync(p, buf);
      d.store.set('/done.mp3.fmfpart', buf); // 上次传完但 MOVE 前中断
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.equal(d.stats.fullPut, 0);
      assert.equal(d.stats.appendOk, 0);
      assert.ok(d.store.has('/done.mp3'));
      assert.equal(Buffer.compare(d.store.get('/done.mp3'), buf), 0);
    } finally { await d.close(); }
  });
});

test('服务器拒绝 Content-Range → 回退全量覆盖，结果仍正确', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ contentRange: 'reject' });
    try {
      const buf = makeBuf(1_000_000);
      const p = path.join(dir, 'reject.mp3');
      fs.writeFileSync(p, buf);
      d.store.set('/reject.mp3.fmfpart', buf.subarray(0, 300_000));
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.notEqual(r.results[0].resumed, true, '追加失败回退全量，不算续传成功');
      assert.equal(Buffer.compare(d.store.get('/reject.mp3'), buf), 0);
    } finally { await d.close(); }
  });
});

test('服务器忽略 Content-Range（整体覆盖语义）→ 大小校验兜底回退全量', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ contentRange: 'ignore' });
    try {
      const buf = makeBuf(1_200_000);
      const p = path.join(dir, 'ignore.mp3');
      fs.writeFileSync(p, buf);
      d.store.set('/ignore.mp3.fmfpart', buf.subarray(0, 400_000));
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.equal(Buffer.compare(d.store.get('/ignore.mp3'), buf), 0);
      assert.equal(d.store.get('/ignore.mp3').length, buf.length, '忽略追加后校验必须兜底');
    } finally { await d.close(); }
  });
});

test('MOVE 受限服务器 → COPY 收尾并清理临时文件', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ move: 'deny' });
    try {
      const buf = makeBuf(700_000);
      const p = path.join(dir, 'nomove.mp3');
      fs.writeFileSync(p, buf);
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.ok(d.store.has('/nomove.mp3'));
      assert.equal(d.stats.copies, 1, '应走 COPY 回退');
      assert.ok(!d.store.has('/nomove.mp3.fmfpart'), 'COPY 收尾后应删除临时文件');
      assert.equal(Buffer.compare(d.store.get('/nomove.mp3'), buf), 0);
    } finally { await d.close(); }
  });
});

test('瞬时 500 → 自动重试成功', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({ failFirstFullPut: 1 });
    try {
      const buf = makeBuf(300_000);
      const p = path.join(dir, 'retry.mp3');
      fs.writeFileSync(p, buf);
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [p] });
      assert.equal(r.success, 1);
      assert.equal(d.stats.fullPut500, 1);
      assert.equal(Buffer.compare(d.store.get('/retry.mp3'), buf), 0);
    } finally { await d.close(); }
  });
});

test('本地文件不存在 → 按失败计，不崩溃、不误报成功', async () => {
  await withTmp(async (dir) => {
    const d = await startMockDav({});
    try {
      const r = await uploadFiles({ client: d.client, remoteDir: '/', files: [path.join(dir, 'ghost.mp3')], retries: 1 });
      assert.equal(r.fail, 1);
      assert.equal(r.success, 0);
      assert.ok(r.results[0].message);
    } finally { await d.close(); }
  });
});

// ────────────────────────── 运行器 ──────────────────────────
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e?.stack || e}`);
  }
}
console.log(failed ? `\n${failed}/${tests.length} FAILED` : `\nAll ${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
