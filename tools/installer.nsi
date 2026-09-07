; Fuck For Music — NSIS 安装脚本（V3.2.0 起替代 7z SFX 方案）
; 由 tools/make-installer.cjs 调用 makensis 编译，可用 -D 覆盖：
;   -DVERSION=3.2.0  -DAPP_DIR=<便携版目录>  -DOUT=<Setup.exe 输出路径>  -DEST_SIZE_KB=<安装体积KB>
Unicode true
ManifestDPIAware true

!include "MUI2.nsh"

!ifndef APP_NAME
  !define APP_NAME "Fuck For Music"
!endif
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef APP_DIR
  !define APP_DIR "..\dist_electron\Fuck For Music-win32-x64"
!endif
!ifndef OUT
  !define OUT "..\dist_electron\Fuck For Music Setup.exe"
!endif
!ifndef EST_SIZE_KB
  !define EST_SIZE_KB 220000
!endif

!define APP_EXE "${APP_NAME}.exe"
!define UNINST_EXE "Uninstall ${APP_NAME}.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_NAME} ${VERSION}"
OutFile "${OUT}"
InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; 安装器自身的版本资源（资源管理器「属性 → 详细信息」可见）
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} 安装程序"
VIAddVersionKey "FileVersion" "${VERSION}.0"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${APP_NAME}"
VIAddVersionKey "LegalCopyright" "MIT License"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即运行 ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"

  ; 开始菜单 + 桌面快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  ; 卸载器 + 注册到「设置 → 应用和功能」
  WriteUninstaller "$INSTDIR\${UNINST_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP_NAME} ${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" "$INSTDIR\${UNINST_EXE}"
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" "$INSTDIR\${UNINST_EXE} /S"
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" ${EST_SIZE_KB}
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 0x00000001
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 0x00000001
SectionEnd

Section "Uninstall"
  ; 关闭正在运行的应用（忽略失败：进程本就不在）
  ExecWait 'taskkill /IM "${APP_EXE}" /F' ; $INSTDIR 卸载前先尝试结束进程
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd
