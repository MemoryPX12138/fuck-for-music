# Fuck For Music

> 让音乐回归原本的样子

一款 Windows 桌面应用：将主流国产音乐客户端的加密音频格式**批量解密**为通用格式（FLAC / MP3 等），输出直接落盘、完全免下载；内置 NAS（WebDAV）上传与本地音乐播放器。

> ⚠️ **免责声明**：本项目仅供个人学习研究与已购内容的本地备份使用，请勿用于任何商业用途或侵权传播。本项目与任何音乐平台无关，使用者须遵守所在地区法律法规，因使用本项目产生的一切后果由使用者自行承担。

## ✨ 功能

- **全格式解密**：QMC / NCM / KGM / KWM / XM / UC / X2M / X3M / MG3D 系列及各类缓存格式，全部支持
- **批量转换**：多线程并行（默认 CPU 满核）、平铺看板实时进度、完成汇总一键直达上传
- **输出免下载**：解密结果直接写入指定文件夹，同名自动避让
- **NAS 上传**（WebDAV 直连）：
  - 秒传——远端同名且大小一致自动跳过
  - 断点续传——临时分片 + 追加写入，中断后重跑自动续传，服务器不支持追加时自动回退
  - 原子收尾——MOVE / COPY / 直传三级回退，目标文件名下永远不会出现半截文件
  - 流式上传、逐文件重试、实时进度
- **音乐播放器**：原生解码 + ffmpeg 软解、在线封面与歌词（lrclib 兜底）、全屏逐行歌词
- **现代界面**：亮 / 暗双主题（Design System V3，WCAG AA 对比度）、简体中文 / English 双语
- **安装体验**：NSIS 标准安装向导（选目录、卸载器、应用列表注册）+ 免安装便携版

## 🖥 界面

三个标签页：**转换工作台**（拖入加密文件一键批量解密）/ **NAS 专区**（曲库管理与一键上传）/ **设置**（WebDAV、线程数、主题、语言）。

## 📦 下载与安装

从 [Releases](../../releases) 下载：

- `Fuck For Music Setup.exe` — 标准安装包，双击按向导安装（含卸载器）
- 便携版目录 — 解压即用，不写注册表

## 🔨 从源码构建

```bash
npm install
npm run build:win-full   # 一键产出便携版 + NSIS 安装包（dist_electron/）
node tools/test-webdav-upload.mjs   # 上传引擎单元测试（内置 mock 服务器，11 场景）
```

要求：Node.js ≥ 18，Windows x64。NSIS 编译器缺失时构建脚本会自动获取。

## 🧱 技术栈

Electron 33 · Vue 3 · Vite 6 · worker_threads 多线程解密池 · webdav 客户端 · NSIS

## 📄 许可证

[MIT](LICENSE)

> 解密算法移植自开源项目 [unlock-music](https://github.com/ix64/unlock-music)（MIT），在此致谢。
