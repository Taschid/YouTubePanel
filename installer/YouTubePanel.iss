#define AppName "YouTubePanel"
#ifndef AppVersion
  #define AppVersion "0.5.0"
#endif
#define AppPublisher "jcode"

[Setup]
AppId={{2CC6D5C1-3D4C-4419-B23C-32983278F660}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\YouTubePanel
DefaultGroupName=YouTubePanel
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=YouTubePanel-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=YouTubePanel
SetupLogging=yes

[Files]
Source: "build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\payload\YouTubePanel.plugin.js"; DestDir: "{userappdata}\BetterDiscord\plugins"; Flags: ignoreversion
Source: "build\payload\stop-sidecar.ps1"; DestDir: "{tmp}"; Flags: dontcopy

[InstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\bin"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "YouTubePanelSidecar"; ValueData: """{sys}\wscript.exe"" //B ""{app}\start-sidecar.vbs"""; Flags: uninsdeletevalue

[Icons]
Name: "{userprograms}\YouTubePanel\YouTubePanel README"; Filename: "{app}\README.txt"
Name: "{userprograms}\YouTubePanel\Uninstall YouTubePanel"; Filename: "{uninstallexe}"

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\stop-sidecar.ps1"" -InstallDir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "StopSidecar"

[UninstallDelete]
Type: files; Name: "{app}\sidecar.pid"
Type: files; Name: "{app}\sidecar.log"
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\BetterDiscord\plugins'));
  if not Result then
    MsgBox('BetterDiscord was not found.' + #13#10 + #13#10 +
      'Install and run BetterDiscord once, then run this setup again.' + #13#10 +
      'Expected folder: ' + ExpandConstant('{userappdata}\BetterDiscord\plugins'),
      mbError, MB_OK);
end;

procedure StopOldSidecar();
var
  ResultCode: Integer;
begin
  ExtractTemporaryFile('stop-sidecar.ps1');
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\stop-sidecar.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure ConfigurePlugin();
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\configure-plugin.ps1') +
    '" -PluginDir "' + ExpandConstant('{userappdata}\BetterDiscord\plugins') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PluginPath: String;
begin
  if CurStep = ssInstall then
  begin
    StopOldSidecar();
    PluginPath := ExpandConstant('{userappdata}\BetterDiscord\plugins\YouTubePanel.plugin.js');
    if FileExists(PluginPath) then
      CopyFile(PluginPath, PluginPath + '.bak', False);
  end
  else if CurStep = ssPostInstall then
  begin
    ConfigurePlugin();
    Exec(ExpandConstant('{sys}\wscript.exe'),
      '//B "' + ExpandConstant('{app}\start-sidecar.vbs') + '"',
      '', SW_HIDE, ewNoWait, ResultCode);
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\healthcheck.ps1') + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then
      MsgBox('The YouTubePanel sidecar did not report healthy.' + #13#10 + #13#10 +
        'See the log here:' + #13#10 + ExpandConstant('{app}\sidecar.log') + #13#10 + #13#10 +
        'You can still toggle YouTubePanel in Discord after fixing the sidecar.',
        mbInformation, MB_OK);
  end;
end;
