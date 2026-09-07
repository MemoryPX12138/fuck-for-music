# Changelog

All notable changes to this project are documented in this file.

## [V3.2.0] — 2026-09-07

### Changed

- **Standard NSIS installer** replaces the legacy 7z SFX + script installer:
  modern MUI2 wizard (welcome / install dir / progress / run-on-finish),
  Simplified Chinese & English UI, uninstaller registered in Windows
  "Apps & features" with standard metadata (EstimatedSize computed from the
  payload), desktop & start-menu shortcuts, LZMA solid compression
  (376 MB → 103.7 MB), installer version resource `3.2.0.0`
- `build:win` now ignores stray directories so `app.asar` stays lean

## [V3.1.0] — 2026-09-07

### Added

- **Instant upload**: a remote file with the same name AND same size is
  skipped with zero PUT (no more false skip on same-name-different-content)
- **Resumable uploads**: transfer goes to a `<name>.fmfpart` temp file; on
  retry it resumes from the remote temp size (library probe: SabreDAV PATCH /
  Apache Content-Range, then generic `PUT + Content-Range`), every attempt
  verified against the remote size with automatic full-overwrite fallback
- Atomic finalize: MOVE → COPY → direct PUT fallback chain — the final
  filename never holds partial data
- Streaming PUT (no whole-file buffering) and per-file retries with backoff
- Byte-level progress events; upload dialog shows "instant / resumed xx%";
  summary dialog gains a skipped counter
- 11-scenario unit test suite for the upload engine (bundled mock server)

## [V3.0.0] — 2026-09-07

### Changed

- **Design System V3**: contrast-first token remap — 7-step neutral scale
  (body text at 14.2:1), three-tier brand palettes (tint / deep, WCAG AA
  calibrated), light & dark themes, 8-step type scale, 5 radius steps,
  hairline zero-shadow cards
- Conversion cards: triple state encoding (color bar + status icon + chip)
  with pulsing progress; 44×44 format badges; redesigned settings page
- Full-screen now-playing page with large lyrics typography

## [V2.0.3] — 2026-09-07

### Fixed

- Blank NAS folder picker: a Vue reactive Proxy passed over IPC could not be
  structured-cloned; fixed by deep-copying the config before IPC calls plus
  error fallbacks

## [V2.0.2] — 2026-09-05

### Fixed

- Reactive tabs after language switch, two-way volume binding, metadata API
  moved to https, code-review fixes (play path, fetch race, lyrics fallback,
  fullscreen scroll, cover size cap, ffmpeg window handling, skip counting,
  status feedback)
- Robust WebDAV directory parsing with multi-signal detection and safe
  fallbacks

## [V2.0.1] — 2026-09-05

### Fixed

- Album cover matching fixes, fullscreen now-playing layout hardening

## [V2.0.0] — 2026-09-05

### Added

- Light/dark themes, zh-CN / en i18n, advanced WebDAV upload options
- Music player: native audio + ffmpeg decoding, online cover/lyrics,
  immersive full-screen lyrics page
- Initial release of the batch decryption workstation
