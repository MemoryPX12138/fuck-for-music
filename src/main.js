import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { initLocale } from './i18n';

async function boot() {
  let settings = {};
  try { settings = await window.fmf.getSettings(); } catch { /* 首次运行 */ }
  // 挂载前应用主题 + 语言，避免首屏白闪/语言跳动
  const theme = settings.theme || 'light';
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  initLocale(settings.locale);
  createApp(App).mount('#app');
}
boot();
