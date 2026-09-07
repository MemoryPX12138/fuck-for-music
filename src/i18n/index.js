// 轻量自建 i18n：reactive locale + t() 字典翻译，不引入第三方依赖
import { reactive, computed } from 'vue';
import zhCN from './zh-CN.js';
import enUS from './en-US.js';

const messages = { 'zh-CN': zhCN, 'en-US': enUS };

export const i18n = reactive({ locale: 'zh-CN' });

export function availableLocales() {
  return Object.keys(messages);
}

export function setLocale(locale) {
  if (messages[locale]) i18n.locale = locale;
  try { localStorage.setItem('fmf.locale', i18n.locale); } catch { /* noop */ }
}

export function initLocale(saved) {
  setLocale(saved || 'zh-CN');
}

export function t(key, params) {
  const dict = messages[i18n.locale] || messages['zh-CN'];
  let str = dict[key] ?? messages['zh-CN'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) str = str.replace(`{${k}}`, String(v));
  }
  return str;
}

// 组件内使用：const { t, locale } = useI18n();
// t() 在渲染期间读取 i18n.locale，切换 locale 时 Vue 会自动重新渲染。
export function useI18n() {
  return {
    t,
    locale: computed(() => i18n.locale),
  };
}
