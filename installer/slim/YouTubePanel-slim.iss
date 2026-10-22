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
const
  NodeZipUrl = 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip';
  NodeZipHash = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73';
  MpvUrl = 'https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261021/mpv-x86_64-20261021-git-e471496c56.7z';
  MpvHash = '4A355F3E89C83FABC730D33FB4E759DFEC747806ED2287B61A90D1681B83E8D3';
  YtDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21/yt-dlp.exe';
  YtDlpHash = '33121d192d706e62f684a06f80918e3f3a8ba52ac3a65213b6951c39c7d9f555';

var
  DownloadPage: TDownloadWizardPage;

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
  Result := DirExists(ExpandConstant('{userappdata}\BetterDiscord\plugins'));
  if not Result then
    MsgBox('BetterDiscord was not found.' + #13#10 + #13#10 +
      'Install and run BetterDiscord once, then run this setup again.' + #13#10 +
      'Expected folder: ' + ExpandConstant('{userappdata}\BetterDiscord\plugins'),
      mbError, MB_OK);
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
  if FileExists(Tmp + '\mpv-extract\d3dcompiler_43.dll') then
    CopyFile(Tmp + '\mpv-extract\d3dcompiler_43.dll', App + '\bin\d3dcompiler_43.dll', False);

  if not CopyFile(Tmp + '\yt-dlp.exe', App + '\bin\yt-dlp.exe', False) then
    RaiseException('Could not install yt-dlp.exe.');
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
      MsgBox('YouTubePanel could not install its runtime.' + #13#10 + #13#10 +
        GetExceptionMessage + #13#10 + #13#10 +
        'Run the installer again while online.', mbCriticalError, MB_OK);
      RaiseException(GetExceptionMessage);
    end;

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
