<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="logo">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path d="M9 18V5l12-2v13" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="6" cy="18" r="3" fill="#fff"/>
            <circle cx="18" cy="16" r="3" fill="#fff"/>
          </svg>
        </div>
        <div class="brand-text">
          <h1>Fuck For Music</h1>
          <p>{{ t('app.subtitle') }}</p>
        </div>
      </div>
      <div class="top-right">
        <button class="theme-toggle" @click="toggleTheme" :title="t('app.versionBadge')">
          {{ isDark ? '☾' : '☀' }}
        </button>
        <nav class="seg">
          <button v-for="tp in tabs" :key="tp.id" :class="['seg-item', { active: tab === tp.id }]" @click="tab = tp.id">
            {{ tp.label }}
          </button>
        </nav>
        <span class="ver-chip">v{{ version }}</span>
      </div>
    </header>

    <main class="content">
      <ConvertBoard v-show="tab === 'convert'" ref="convertRef" :settings="settings"
        @converted="onConverted" @go-fnmusic="gotoFnMusic" />
      <FnMusic v-show="tab === 'fnmusic'" :settings="settings" :converted="convertedFiles" />
      <SettingsPage v-show="tab === 'settings'" :settings="settings" @save="onSaveSettings" />
    </main>

    <PlayerBar />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, provide } from 'vue';
import ConvertBoard from './components/ConvertBoard.vue';
import FnMusic from './components/FnMusic.vue';
import SettingsPage from './components/SettingsPage.vue';
import PlayerBar from './player/PlayerBar.vue';
import { useI18n } from './i18n';
const { t } = useI18n();

const tabs = computed(() => [
  { id: 'convert', label: t('tab.convert') },
  { id: 'fnmusic', label: t('tab.fnmusic') },
  { id: 'settings', label: t('tab.settings') },
]);
const tab = ref('convert');
const settings = reactive({ outDir: '', webdav: {}, threads: 4, cpuCount: 4, threadsMax: 8, theme: 'light', locale: 'zh-CN' });
const convertedFiles = ref([]);
const version = ref('3.2.0');
const isDark = computed(() => settings.theme === 'dark');

onMounted(async () => {
  Object.assign(settings, await window.fmf.getSettings());
  document.documentElement.dataset.theme = settings.theme === 'dark' ? 'dark' : 'light';
  try { const info = await window.fmf.getAppInfo(); if (info?.version) version.value = info.version; } catch { /* noop */ }
});

function toggleTheme() {
  settings.theme = isDark.value ? 'light' : 'dark';
  document.documentElement.dataset.theme = settings.theme;
  window.fmf.setSettings({ theme: settings.theme });
}

function onSaveSettings(patch) { Object.assign(settings, patch); }

function onConverted(successFiles) {
  const seen = new Set(convertedFiles.value.map((f) => f.path));
  for (const f of successFiles) if (!seen.has(f.path)) convertedFiles.value.push(f);
}

function gotoFnMusic() { tab.value = 'fnmusic'; }
provide('fmf-settings', settings);
</script>

<style scoped>
.shell { height: 100vh; display: flex; flex-direction: column; }

/* 顶栏：页面左右留白 64（V3 间距标尺） */
.topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 64px 0;
}

/* 品牌区：渐变装饰层 logo + Title 1 应用名 */
.brand { display: flex; align-items: center; gap: 12px; }
.logo {
  width: 46px; height: 46px; border-radius: 10px;
  background: linear-gradient(135deg, var(--sage), var(--mist));
  display: grid; place-items: center;
}
.brand-text h1 { font-size: 24px; font-weight: 600; line-height: 32px; letter-spacing: -0.3px; }
.brand-text p { font-size: 13px; line-height: 18px; color: var(--ink-soft); margin-top: 2px; letter-spacing: 0.08em; }

.top-right { display: flex; align-items: center; gap: 12px; }

/* 主题切换 = 图标按钮（40×40 圆形，panel 底 + 发丝线） */
.theme-toggle {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--panel); border: 1px solid var(--line);
  color: var(--ink-soft); font-size: 16px; display: grid; place-items: center;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.theme-toggle:hover { background: var(--card); color: var(--ink); }
.theme-toggle:active { transform: scale(0.97); }

/* 版本角标：Fine 11（<13px 不用 inkFaint，取 inkSoft） */
.ver-chip {
  font-size: 11px; line-height: 16px; font-weight: 400; color: var(--ink-soft);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px;
}

/* 分段控制器：sageTint 容器 + card 激活段（1px 轻投影），高 44 / 内距 4 */
.seg {
  background: var(--sage-tint); border-radius: 999px;
  padding: 4px; display: flex; gap: 2px;
}
.seg-item {
  padding: 8px 18px; border-radius: 999px;
  font-size: 15px; line-height: 20px; font-weight: 400; letter-spacing: -0.1px;
  color: var(--ink-soft); background: transparent;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}
.seg-item.active {
  background: var(--card); color: var(--ink); font-weight: 600;
  box-shadow: 0 1px 2px rgba(90, 85, 70, 0.14);
}
:root[data-theme="dark"] .seg-item.active { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45); }
.seg-item:not(.active):hover { color: var(--ink); }

.content { flex: 1; min-height: 0; padding: 24px 64px 32px; display: flex; flex-direction: column; }
</style>
