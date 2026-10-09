; Inno Setup 6 script for Telnyx Edge. Built by windows/build.ps1, which passes
; AppVersion, Arch (x64 | arm64), SourceDir, OutputDir and OutputName.
; Installs per user (no admin), under %LOCALAPPDATA%\Programs\Telnyx Edge.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Arch
  #define Arch "x64"
#endif

[Setup]
AppId={{6D1C8F2B-4E3A-4B7B-9E61-2A5D7C0F9B34}
AppName=Telnyx Edge
AppVersion={#AppVersion}
AppVerName=Telnyx Edge {#AppVersion}
AppPublisher=team-telnyx
AppPublisherURL=https://github.com/team-telnyx/telnyx-edge-gui
AppSupportURL=https://github.com/team-telnyx/telnyx-edge-gui#readme
DefaultDirName={autopf}\Telnyx Edge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
SetupIconFile=app.ico
UninstallDisplayIcon={app}\TelnyxEdge.exe
UninstallDisplayName=Telnyx Edge
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Windows 10 1809 or later (WebView2's minimum); built and tested for Windows 11.
MinVersion=10.0.17763
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
; Close a running copy before updating it.
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[InstallDelete]
; Don't leave files from an older version's server behind.
Type: filesandordirs; Name: "{app}\server"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Telnyx Edge"; Filename: "{app}\TelnyxEdge.exe"
Name: "{autodesktop}\Telnyx Edge"; Filename: "{app}\TelnyxEdge.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TelnyxEdge.exe"; Description: "Open Telnyx Edge"; Flags: nowait postinstall skipifsilent

; Profiles (%LOCALAPPDATA%\Telnyx Edge Control Panel) and saved sign-ins
; (Credential Manager) are kept on uninstall, so reinstalling brings them back.
