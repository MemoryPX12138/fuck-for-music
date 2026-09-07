// Apple 风格线性图标（stroke-based，currentColor 继承）
// 每个图标是一段 SVG 内部标记；实心图标自行带 fill/stroke 覆盖
export const icons = {
  shuffle:
    '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
  prev: '<path d="M19 20 9 12l10-8z" fill="currentColor" stroke="none"/><rect x="5" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86a1 1 0 0 0-1.5.86z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="2.6" height="16" rx="1.3" fill="currentColor" stroke="none"/><rect x="15.4" y="4" width="2.6" height="16" rx="1.3" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 20 15 12 5 4z" fill="currentColor" stroke="none"/><rect x="17" y="4" width="2" height="16" rx="1" fill="currentColor" stroke="none"/>',
  repeat:
    '<path d="M4 12a8 8 0 0 1 13.65-5.65"/><path d="M20 12a8 8 0 0 1-13.65 5.65"/><path d="M18 2v5h-5"/><path d="M6 22v-5h5"/>',
  x: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  lyrics:
    '<path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h7"/><circle cx="18" cy="15" r="2.6"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};
