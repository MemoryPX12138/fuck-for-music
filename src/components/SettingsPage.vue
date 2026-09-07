<template>
  <div class="settings">
    <div class="card panel">
      <h3>{{ t('settings.convert') }}</h3>
      <div class="row">
        <label>{{ t('settings.outDir') }}</label>
        <div class="row-body">
          <input type="text" :value="s.outDir" readonly :placeholder="t('settings.outDirPh')" @click="chooseOut" />
          <button class="btn btn-ghost" @click="chooseOut">{{ t('btn.browse') }}</button>
          <button class="btn btn-ghost" v-if="s.outDir" @click="openOut">{{ t('btn.open') }}</button>
        </div>
      </div>
      <div class="row">
        <label>{{ t('settings.threads') }}</label>
        <div class="row-body">
          <input type="range" min="1" :max="s.threadsMax || 8" v-model.number="s.threads" @change="save" />
          <span class="val">{{ t('settings.threadsVal', { n: s.threads, c: s.cpuCount }) }}</span>
        </div>
      </div>
    </div>

    <div class="card panel">
      <h3>{{ t('settings.nas') }}</h3>
      <p class="tip">{{ t('settings.nasTip') }}</p>
      <div class="row">
        <label>{{ t('settings.url') }}</label>
        <div class="row-body">
          <input type="text" v-model="s.webdav.url" placeholder="http://192.168.1.10:6666" @change="save" />
        </div>
      </div>
      <div class="row">
        <label>{{ t('settings.username') }}</label>
        <div class="row-body"><input type="text" v-model="s.webdav.username" @change="save" /></div>
      </div>
      <div class="row">
        <label>{{ t('settings.password') }}</label>
        <div class="row-body"><input type="password" v-model="s.webdav.password" @change="save" /></div>
      </div>
      <div class="row">
        <label></label>
        <div class="row-body">
          <button class="btn btn-secondary" @click="test">{{ t('settings.test') }}</button>
          <span :class="['test-result', testResult.ok ? 'ok' : 'bad']" v-if="testResult.shown">
            {{ testResult.ok ? t('settings.testOk') : t('settings.testFail', { m: testResult.message }) }}
          </span>
        </div>
      </div>
    </div>

    <div class="card panel">
      <h3>{{ t('settings.advanced') }}</h3>
      <div class="row">
        <label>{{ t('settings.timeout') }}</label>
        <div class="row-body">
          <input type="number" min="5000" max="120000" step="1000" v-model.number="s.webdav.timeout" @change="save" />
          <span class="val">ms</span>
        </div>
      </div>
      <div class="row">
        <label>{{ t('settings.concurrency') }}</label>
        <div class="row-body">
          <input type="range" min="1" max="8" v-model.number="s.webdav.concurrency" @change="save" />
          <span class="val">{{ s.webdav.concurrency || 1 }}</span>
        </div>
      </div>
      <div class="row">
        <label>{{ t('settings.skipExisting') }}</label>
        <div class="row-body">
          <button
            type="button"
            class="toggle"
            :class="{ on: !!s.webdav.skipExisting }"
            role="switch"
            :aria-checked="!!s.webdav.skipExisting"
            @click="toggleSkip"
          ></button>
        </div>
      </div>
    </div>

    <div class="card panel">
      <h3>{{ t('settings.theme') }} · {{ t('settings.language') }}</h3>
      <div class="row">
        <label>{{ t('settings.theme') }}</label>
        <div class="row-body">
          <select v-model="s.theme" @change="onTheme">
            <option value="light">{{ t('theme.light') }}</option>
            <option value="dark">{{ t('theme.dark') }}</option>
          </select>
        </div>
      </div>
      <div class="row">
        <label>{{ t('settings.language') }}</label>
        <div class="row-body">
          <select v-model="s.locale" @change="onLocale">
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted, watch } from 'vue';
import { useI18n, setLocale } from '../i18n';
const { t } = useI18n();

const props = defineProps({ settings: Object });
const emit = defineEmits(['save']);
const s = reactive({ outDir: '', threads: 4, threadsMax: 8, cpuCount: 4, webdav: { timeout: 30000, concurrency: 3, skipExisting: false }, theme: 'light', locale: 'zh-CN' });
const testResult = reactive({ shown: false, ok: false, message: '' });

onMounted(async () => {
  const st = await window.fmf.getSettings();
  Object.assign(s, st);
  if (!s.webdav) s.webdav = {};
  s.webdav.timeout = s.webdav.timeout || 30000;
  s.webdav.concurrency = s.webdav.concurrency || 3;
  s.webdav.skipExisting = s.webdav.skipExisting || false;
});

watch(() => props.settings, (st) => { Object.assign(s, st); }, { deep: true });

function save() {
  window.fmf.setSettings({ outDir: s.outDir, threads: s.threads, theme: s.theme, locale: s.locale, webdav: { ...s.webdav } });
  emit('save', { outDir: s.outDir, threads: s.threads, theme: s.theme, locale: s.locale, webdav: { ...s.webdav } });
}

function onTheme() {
  document.documentElement.dataset.theme = s.theme === 'dark' ? 'dark' : 'light';
  save();
}
function onLocale() {
  setLocale(s.locale);
  save();
}
function toggleSkip() {
  s.webdav.skipExisting = !s.webdav.skipExisting;
  save();
}

async function chooseOut() {
  const dir = await window.fmf.selectFolder('选择转换结果保存文件夹');
  if (!dir) return;
  s.outDir = dir;
  save();
}

function openOut() { window.fmf.openPath(s.outDir); }

async function test() {
  testResult.shown = true;
  testResult.ok = false;
  testResult.message = t('settings.testing');
  save();
  const r = await window.fmf.webdavTest({ ...s.webdav });
  testResult.ok = r.ok;
  testResult.message = r.message || '';
}
</script>

<style scoped>
.settings { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 32px; max-width: 760px; }

/* 设置分组：卡片内边距 16×2 + 分组呼吸空间（24 在标尺内） */
.panel { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.panel h3 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.2px; }
.tip { font-size: 13px; line-height: 18px; color: var(--ink-faint); margin-top: -8px; }

/* 输入框标签在上（V3 规范 5.4） */
.row { display: flex; flex-direction: column; gap: 8px; }
.row > label { font-size: 13px; line-height: 18px; color: var(--ink-soft); }
.row-body { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.row-body input[type="text"], .row-body input[type="password"], .row-body input[type="number"] { flex: 1; min-width: 200px; }
.row-body input[type="number"] { max-width: 160px; }
.row-body input[type="range"] { flex: 1; accent-color: var(--sage-deep); }
.row-body select { flex: 1; max-width: 240px; }
.val { font-size: 13px; line-height: 18px; color: var(--ink-soft); white-space: nowrap; font-variant-numeric: tabular-nums; }

.test-result { font-size: 13px; line-height: 18px; font-weight: 600; }
.test-result.ok { color: var(--ok); }
.test-result.bad { color: var(--bad); }
</style>
