// 多线程转换线程池：并发数 = min(CPU 核心数, 8)
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'decrypt-worker.mjs');

export function workerCount() {
  return Math.max(2, Math.min(os.cpus().length, 8));
}

export class ConvertPool {
  /**
   * @param {Array<{src:string}>} files
   * @param {string} outDir
   * @param {(evt: object) => void} onEvent  {type:'start'|'done', id, src, ok, dest, message, finished, total, success, fail}
   */
  constructor(files, outDir, threads, onEvent) {
    this.files = files;
    this.outDir = outDir;
    this.threads = Math.max(1, threads);
    this.onEvent = onEvent;
    this.next = 0;
    this.finished = 0; this.success = 0; this.fail = 0;
    this.aborted = false;
    this.workers = new Set();
    this.results = [];
  }

  run() {
    return new Promise((resolve) => {
      const spawn = () => {
        if (this.aborted || this.workers.size >= this.threads || this.next >= this.files.length) return;
        const w = new Worker(WORKER_PATH);
        this.workers.add(w);
        w.unref?.();
        w.on('message', (msg) => this._onResult(msg, w, spawn));
        w.on('error', (err) => {
          this._onResult({ ok: false, src: '?', message: err.message }, w, spawn);
        });
        this._feed(w, spawn);
      };
      for (let i = 0; i < this.threads; i++) spawn();
      this._resolve = resolve;
    });
  }

  _feed(w) {
    if (this.aborted) return;
    if (this.next >= this.files.length) {
      if (this.workers.size === 0) this._resolve?.();
      return;
    }
    const idx = this.next++;
    const file = this.files[idx];
    w.__current = { id: idx, src: file.src };
    w.postMessage({ id: idx, src: file.src, outDir: this.outDir });
    this.onEvent({ type: 'start', id: idx, src: file.src });
  }

  _onResult(msg, w, spawn) {
    this.finished++;
    if (msg.ok) this.success++; else this.fail++;
    this.results.push(msg);
    this.onEvent({
      type: 'done', id: msg.id, src: msg.src, ok: msg.ok, dest: msg.dest, message: msg.message,
      finished: this.finished, total: this.files.length, success: this.success, fail: this.fail,
    });
    if (this.finished >= this.files.length) {
      for (const k of this.workers) k.terminate();
      this.workers.clear();
      this._resolve?.({ total: this.files.length, success: this.success, fail: this.fail, results: this.results });
      return;
    }
    this._feed(w);
  }

  abort() {
    this.aborted = true;
    for (const w of this.workers) w.terminate();
    this.workers.clear();
    this._resolve?.({ total: this.files.length, success: this.success, fail: this.fail, aborted: true, results: this.results });
  }
}
