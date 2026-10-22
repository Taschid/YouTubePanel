#define AppName "YouTubePanel"
#ifndef AppVersion
  #define AppVersion "0.5.3"
#endif
#define AppPublisher "jcode"

[Setup]
AppId={{2CC6D5C1-3D4C-4419-B23C-32983278F660}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={code:GetChosenInstallDir}
UsePreviousAppDir=no
DefaultGroupName=YouTubePanel
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\output
OutputBaseFilename=YouTubePanel-Setup-{#AppVersion}-slim
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern dynamic
UninstallDisplayName=YouTubePanel
SetupLogging=yes
ArchiveExtraction=full

[Files]
Source: "build\payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The plugin is installed by [Code] with retries so a locked BetterDiscord
; plugin file never blocks setup on an invisible file-in-use prompt.
Source: "build\payload\YouTubePanel.plugin.js"; DestDir: "{tmp}"; Flags: dontcopy
Source: "build\payload\stop-sidecar.ps1"; DestDir: "{tmp}"; Flags: dontcopy
Source: "build\payload\panel-common.ps1"; DestDir: "{tmp}"; Flags: dontcopy

[InstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\bin"

[Registry]
; Primary logon launcher: hidden PowerShell directly. Windows Script Host policy
; cannot break startup because wscript.exe is only the manual fallback.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "YouTubePanelSidecar"; ValueData: """{sys}\WindowsPowerShell\v1.0\powershell.exe"" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\start-sidecar.ps1"" -InstallDir ""{app}"""; Flags: uninsdeletevalue

[Icons]
Name: "{userprograms}\YouTubePanel\YouTubePanel README"; Filename: "{app}\README.txt"
Name: "{userprograms}\YouTubePanel\Uninstall YouTubePanel"; Filename: "{uninstallexe}"

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\stop-sidecar.ps1"" -InstallDir ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "StopSidecar"

[UninstallDelete]
Type: files; Name: "{app}\sidecar.pid"
Type: files; Name: "{app}\sidecar.log"
Type: files; Name: "{app}\sidecar-launch.log"
Type: files; Name: "{app}\path-audit.log"
Type: files; Name: "{app}\install-report.json"
Type: files; Name: "{app}\configure-report.json"
; Remove the plugin itself. YouTubePanel.config.json and its .bak are settings
; and are intentionally preserved (documented in README.txt).
Type: files; Name: "{userappdata}\BetterDiscord\plugins\YouTubePanel.plugin.js"
Type: files; Name: "{userappdata}\BetterDiscord\plugins\YouTubePanel.plugin.js.bak"
Type: filesandordirs; Name: "{app}"

[Code]
const
  NodeZipUrl = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip';
  NodeZipHash = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
  MpvUrl = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261021/mpv-x86_64-20261021-git-e471496c56.7z';
  MpvHash = '4A355F3E89C83FABC730D33FB4E759DFEC747806ED2287B61A90D1681B83E8D3';
  YtDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe';
  YtDlpHash = '33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555';

var
  DownloadPage: TDownloadWizardPage;
  ChosenInstallDir: String;

function GetFileAttributesW(lpFileName: String): Cardinal;
external 'GetFileAttributesW@kernel32.dll stdcall';

function StartsWithText(const Value, Prefix: String): Boolean;
begin
  Result := CompareText(Copy(Value, 1, Length(Prefix)), Prefix) = 0;
end;

function GetPublicDir(): String;
begin
  Result := GetEnv('PUBLIC');
  if (Result = '') or (not DirExists(Result)) then
    Result := ExpandConstant('{sd}\Users\Public');
end;

function GetPublicInstallDir(): String;
begin
  Result := AddBackslash(GetPublicDir()) + 'YouTubePanel';
end;

function IsOneDrivePath(Path: String): Boolean;
var
  Base: String;
begin
  Result := False;
  Base := GetEnv('OneDrive');
  if (Base <> '') and (CompareText(Path, Base) = 0) then Result := True;
  if (Base <> '') and StartsWithText(Path, AddBackslash(Base)) then Result := True;
  Base := GetEnv('OneDriveConsumer');
  if (Base <> '') and (CompareText(Path, Base) = 0) then Result := True;
  if (Base <> '') and StartsWithText(Path, AddBackslash(Base)) then Result := True;
  Base := GetEnv('OneDriveCommercial');
  if (Base <> '') and (CompareText(Path, Base) = 0) then Result := True;
  if (Base <> '') and StartsWithText(Path, AddBackslash(Base)) then Result := True;
end;

function PathHasReparsePoint(Path: String): Boolean;
var
  Current: String;
  Attr: Cardinal;
begin
  Result := False;
  Current := Path;
  while Length(Current) >= 3 do
  begin
    Attr := GetFileAttributesW(Current);
    if (Attr <> $FFFFFFFF) and ((Attr and FILE_ATTRIBUTE_REPARSE_POINT) <> 0) then
    begin
      Result := True;
      Exit;
    end;
    if Length(Current) = 3 then Break;
    Current := ExtractFileDir(Current);
  end;
end;

function CanUseInstallDir(Path: String): Boolean;
var
  Probe: String;
  Ok: Boolean;
begin
  Result := False;
  if Trim(Path) = '' then Exit;
  if IsOneDrivePath(Path) then Exit;
  if PathHasReparsePoint(Path) then Exit;
  if not ForceDirectories(Path) then Exit;
  Probe := AddBackslash(Path) + '.youtubepanel-write-test.tmp';
  Ok := SaveStringToFile(Probe, 'ok', False);
  if Ok then DeleteFile(Probe);
  Result := Ok;
end;

function EnsureChosenInstallDir(): Boolean;
begin
  if ChosenInstallDir <> '' then
  begin
    Result := True;
    Exit;
  end;
  ChosenInstallDir := ExpandConstant('{localappdata}\YouTubePanel');
  if not CanUseInstallDir(ChosenInstallDir) then
  begin
    ChosenInstallDir := GetPublicInstallDir();
    if not CanUseInstallDir(ChosenInstallDir) then
    begin
      ChosenInstallDir := '';
      Result := False;
      Exit;
    end;
  end;
  Result := True;
end;

function GetChosenInstallDir(Param: String): String;
begin
  if ChosenInstallDir = '' then EnsureChosenInstallDir();
  Result := ChosenInstallDir;
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  if ProgressMax <> 0 then
    Log(Format('  %s: %d of %d bytes done.', [FileName, Progress, ProgressMax]))
  else
    Log(Format('  %s: %d bytes done.', [FileName, Progress]));
  Result := True;
end;

function InitializeSetup(): Boolean;
begin
  Result := EnsureChosenInstallDir();
  if not Result then
  begin
    Log('FATAL: no safe local install folder (junction/OneDrive/unwritable). Suggest ' + GetPublicInstallDir());
    if not WizardSilent then
      MsgBox('YouTubePanel could not find a safe local install folder.' + #13#10 + #13#10 +
        'Windows error 448 means a path contains an untrusted junction or cloud placeholder.' + #13#10 +
        'Create a normal local folder and run setup again, for example:' + #13#10 +
        GetPublicInstallDir(),
        mbError, MB_OK);
    Exit;
  end;
  Result := DirExists(ExpandConstant('{userappdata}\BetterDiscord\plugins'));
  if not Result then
  begin
    Log('FATAL: BetterDiscord plugins folder not found: ' + ExpandConstant('{userappdata}\BetterDiscord\plugins'));
    if not WizardSilent then
      MsgBox('BetterDiscord was not found.' + #13#10 + #13#10 +
        'Install and run BetterDiscord once, then run this setup again.' + #13#10 +
        'Expected folder: ' + ExpandConstant('{userappdata}\BetterDiscord\plugins'),
        mbError, MB_OK);
  end;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(
    SetupMessage(msgWizardPreparing),
    'YouTubePanel needs Node.js, mpv, and yt-dlp. They are downloaded once and verified.',
    @OnDownloadProgress);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Error: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not CanUseInstallDir(WizardForm.DirEdit.Text) then
    begin
      Log('Rejected install folder: ' + WizardForm.DirEdit.Text);
      if not WizardSilent then
        MsgBox('That folder cannot be used.' + #13#10 + #13#10 +
          'It is a junction, a OneDrive/cloud path, or it is not writable.' + #13#10 +
          'Choose a normal local folder, for example:' + #13#10 +
          GetPublicInstallDir(),
          mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  if CurPageID <> wpReady then
    exit;

  DownloadPage.Clear;
  DownloadPage.Add(NodeZipUrl, 'node.zip', NodeZipHash);
  DownloadPage.Add(MpvUrl, 'mpv.7z', MpvHash);
  DownloadPage.Add(YtDlpUrl, 'yt-dlp.exe', YtDlpHash);
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      Result := True;
    except
      if DownloadPage.AbortedByUser then
        Log('Aborted by user.')
      else begin
        Error := Format('%s: %s', [DownloadPage.LastBaseNameOrUrl, GetExceptionMessage]);
        SuppressibleMsgBox(AddPeriod(Error), mbCriticalError, MB_OK, IDOK);
      end;
      Result := False;
    end;
  finally
    DownloadPage.Hide;
  end;
end;

procedure EnsureDownloads;
begin
  DownloadTemporaryFile(NodeZipUrl, 'node.zip', NodeZipHash, @OnDownloadProgress);
  DownloadTemporaryFile(MpvUrl, 'mpv.7z', MpvHash, @OnDownloadProgress);
  DownloadTemporaryFile(YtDlpUrl, 'yt-dlp.exe', YtDlpHash, @OnDownloadProgress);
end;

function RunPowerShell(Params: String; Wait: Boolean; var ResultCode: Integer): Boolean;
var
  WaitFlag: TExecWait;
begin
  ResultCode := -1;
  if Wait then WaitFlag := ewWaitUntilTerminated else WaitFlag := ewNoWait;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + Params,
    '', SW_HIDE, WaitFlag, ResultCode);
end;

procedure Delay(Milliseconds: Integer);
begin
  Sleep(Milliseconds);
end;

procedure StopOldSidecar();
var
  ResultCode: Integer;
begin
  ExtractTemporaryFile('stop-sidecar.ps1');
  ExtractTemporaryFile('panel-common.ps1');
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\stop-sidecar.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Log('Stopped previous sidecars (exit ' + IntToStr(ResultCode) + ').');
end;

procedure ConfigurePlugin(ResetPort: Boolean);
var
  ResultCode: Integer;
  Params: String;
begin
  Params := '"' + ExpandConstant('{app}\configure-plugin.ps1') +
    '" -PluginDir "' + ExpandConstant('{userappdata}\BetterDiscord\plugins') +
    '" -SidecarConfig "' + ExpandConstant('{app}\config.json') + '"';
  if ResetPort then Params := Params + ' -ResetPort';
  if not RunPowerShell(Params, True, ResultCode) then
    RaiseException('Could not launch configure-plugin.ps1.');
  if ResultCode <> 0 then
    RaiseException('YouTubePanel could not write its runtime config (configure-plugin.ps1 exit ' + IntToStr(ResultCode) + '). See configure-report.json in ' + ExpandConstant('{app}') + '.');
  Log('Runtime config written (port/token and plugin sidecarUrl are in sync).');
end;

procedure InstallRuntime;
var
  Tmp: String;
  App: String;
begin
  Tmp := ExpandConstant('{tmp}');
  App := ExpandConstant('{app}');
  ForceDirectories(App + '\runtime');
  ForceDirectories(App + '\bin');

  ForceDirectories(Tmp + '\node-extract');
  ExtractArchive(Tmp + '\node.zip', Tmp + '\node-extract', '', False, nil);
  if not CopyFile(Tmp + '\node-extract\node.exe', App + '\runtime\node.exe', False) then
    RaiseException('Could not install node.exe from the verified Node.js archive.');

  ForceDirectories(Tmp + '\mpv-extract');
  ExtractArchive(Tmp + '\mpv.7z', Tmp + '\mpv-extract', '', True, nil);
  if not CopyFile(Tmp + '\mpv-extract\mpv.exe', App + '\bin\mpv.exe', False) then
    RaiseException('Could not install mpv.exe from the verified mpv archive.');

  if not CopyFile(Tmp + '\yt-dlp.exe', App + '\bin\yt-dlp.exe', False) then
    RaiseException('Could not install yt-dlp.exe.');
end;

procedure RunPathAudit();
var
  ResultCode: Integer;
begin
  RunPowerShell('"' + ExpandConstant('{app}\path-audit.ps1') +
    '" -LogPath "' + ExpandConstant('{app}\path-audit.log') + '"', True, ResultCode);
  if ResultCode <> 0 then
  begin
    Log('PATH audit found unsafe entries; see ' + ExpandConstant('{app}\path-audit.log'));
    if not WizardSilent then
      MsgBox('Some folders on your Windows PATH are junctions, unreadable, or missing.' + #13#10 + #13#10 +
        'YouTubePanel still works because its launcher filters those entries out of the sidecar PATH.' + #13#10 +
        'Other tools that walk PATH directly can still fail with Windows error 448.' + #13#10 + #13#10 +
        'Audit log:' + #13#10 + ExpandConstant('{app}\path-audit.log') + #13#10 + #13#10 +
        'If playback fails, remove the flagged PATH entry or restart the sidecar.',
        mbInformation, MB_OK);
  end
  else
    Log('PATH audit clean.');
end;

procedure StartSidecar();
var
  ResultCode: Integer;
begin
  if RunPowerShell('"' + ExpandConstant('{app}\start-sidecar.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') + '"', True, ResultCode) and (ResultCode = 0) then
  begin
    Log('Sidecar started via hidden PowerShell launcher.');
    Exit;
  end;

  Log('PowerShell launcher failed (exit ' + IntToStr(ResultCode) + '); using VBS fallback.');
  if FileExists(ExpandConstant('{app}\start-sidecar.vbs')) then
    Exec(ExpandConstant('{sys}\wscript.exe'),
      '//B "' + ExpandConstant('{app}\start-sidecar.vbs') + '"',
      '', SW_HIDE, ewNoWait, ResultCode);
end;

procedure RunHealthcheck(Mode: String; SkipNetwork: Boolean; var ResultCode: Integer);
var
  Params: String;
begin
  Params := '"' + ExpandConstant('{app}\healthcheck.ps1') +
    '" -InstallDir "' + ExpandConstant('{app}') +
    '" -PluginDir "' + ExpandConstant('{userappdata}\BetterDiscord\plugins') +
    '" -Mode ' + Mode +
    ' -AppVersion "{#AppVersion}"' +
    ' -ReportPath "' + ExpandConstant('{app}\install-report.json') + '"';
  if SkipNetwork then Params := Params + ' -SkipNetwork -LocalTimeoutSeconds 45 -NetworkTimeoutSeconds 5';
  if not RunPowerShell(Params, True, ResultCode) then ResultCode := -1;
end;

procedure ReportFatal(const Message: String);
begin
  Log('FATAL: ' + Message);
  if not WizardSilent then
    MsgBox(Message + #13#10 + #13#10 +
      'Logs and the install report are in:' + #13#10 +
      ExpandConstant('{app}') + #13#10 + #13#10 +
      'Fix the sidecar, then run start-sidecar.ps1 again.',
      mbCriticalError, MB_OK);
end;

procedure StartAndCheck();
var
  ResultCode: Integer;
begin
  ConfigurePlugin(False);
  StartSidecar();
  RunHealthcheck('all', False, ResultCode);

  if ResultCode <> 0 then
  begin
    Log('First sidecar start/check failed (exit ' + IntToStr(ResultCode) + '). Retrying once with a new port.');
    StopOldSidecar();
    ConfigurePlugin(True);
    StartSidecar();
    RunHealthcheck('all', False, ResultCode);
  end;

  if ResultCode <> 0 then
  begin
    ReportFatal('YouTubePanel could not verify its sidecar after two attempts.');
    RaiseException('YouTubePanel sidecar validation failed. See install-report.json in ' + ExpandConstant('{app}') + '.');
  end;
end;

function PluginHeaderValid(Path: String; var Version: String): Boolean;
var
  Lines: TStringList;
  I, P: Integer;
  Line, Value: String;
begin
  Result := False;
  Version := '';
  if not FileExists(Path) then Exit;
  Lines := TStringList.Create;
  try
    try
      Lines.LoadFromFile(Path);
    except
      Result := False;
    end;
    for I := 0 to Lines.Count - 1 do
    begin
      if I > 40 then Break;
      Line := Lines[I];
      if Pos('@name YouTubePanel', Line) > 0 then Result := True;
      if Pos('@version ', Line) > 0 then
      begin
        P := Pos('@version ', Line) + Length('@version ');
        Value := Trim(Copy(Line, P, Length(Line) - P + 1));
        if Value <> '' then Version := Value;
      end;
    end;
    if Version = '' then Result := False;
  finally
    Lines.Free;
  end;
end;

procedure EnsurePluginInstalled();
var
  Dest, Src, TmpSrc, Version: String;
  Attempt: Integer;
begin
  Dest := ExpandConstant('{userappdata}\BetterDiscord\plugins\YouTubePanel.plugin.js');
  Src := ExpandConstant('{app}\YouTubePanel.plugin.js');
  TmpSrc := ExpandConstant('{tmp}\YouTubePanel.plugin.js');

  for Attempt := 1 to 6 do
  begin
    if PluginHeaderValid(Dest, Version) then
    begin
      if CompareText(Version, '{#AppVersion}') = 0 then
      begin
        Log('BetterDiscord plugin validated: version ' + Version);
        Exit;
      end;
      Log('Installed plugin version ' + Version + ' does not match installer version {#AppVersion}; recopying.');
    end;

    if not FileExists(Src) then
    begin
      if not FileExists(TmpSrc) then ExtractTemporaryFile('YouTubePanel.plugin.js');
      Src := TmpSrc;
    end;

    if FileExists(Src) then
    begin
      if CopyFile(Src, Dest, False) then
        Log('Plugin copy attempt ' + IntToStr(Attempt) + ' succeeded.')
      else
        Log('Plugin copy attempt ' + IntToStr(Attempt) + ' failed (file may be locked by BetterDiscord).');
    end;
    Delay(400);
  end;

  if PluginHeaderValid(Dest, Version) then
  begin
    if CompareText(Version, '{#AppVersion}') <> 0 then
      RaiseException('The installed BetterDiscord plugin reports version ' + Version +
        ', expected {#AppVersion}. Close Discord and run setup again.');
    Log('BetterDiscord plugin validated after retries: version ' + Version);
    Exit;
  end;

  RaiseException('Could not install YouTubePanel.plugin.js into ' +
    ExpandConstant('{userappdata}\BetterDiscord\plugins') +
    '. Close Discord/BetterDiscord and run setup again.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PluginPath: String;
begin
  if CurStep = ssInstall then
  begin
    if not CanUseInstallDir(ExpandConstant('{app}')) then
      RaiseException('YouTubePanel cannot install to this folder because it is a junction, a OneDrive/cloud path, or it is not writable. Choose a normal local folder such as ' + GetPublicInstallDir() + '.');
    StopOldSidecar();
    PluginPath := ExpandConstant('{userappdata}\BetterDiscord\plugins\YouTubePanel.plugin.js');
    if FileExists(PluginPath) then
      CopyFile(PluginPath, PluginPath + '.bak', False);
    try
      EnsureDownloads();
    except
      RaiseException('Runtime download failed: ' + GetExceptionMessage);
    end;
  end
  else if CurStep = ssPostInstall then
  begin
    try
      InstallRuntime();
    except
      Log('FATAL: runtime install failed: ' + GetExceptionMessage);
      if not WizardSilent then
        MsgBox('YouTubePanel could not install its runtime.' + #13#10 + #13#10 +
          GetExceptionMessage + #13#10 + #13#10 +
          'Run the installer again while online.', mbCriticalError, MB_OK);
      RaiseException(GetExceptionMessage);
    end;

    EnsurePluginInstalled();
    RunPathAudit();
    StartAndCheck();
  end;
end;
