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
DefaultDirName={code:GetChosenInstallDir}
UsePreviousAppDir=no
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
var
  ChosenInstallDir: String;

function GetFileAttributesW(lpFileName: String): Cardinal;
external 'GetFileAttributesW@kernel32.dll stdcall';

function StartsWithText(const Value, Prefix: String): Boolean;
begin
  Result := CompareText(Copy(Value, 1, Length(Prefix)), Prefix) = 0;
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
    ChosenInstallDir := ExpandConstant('{sd}\Users\Public\YouTubePanel');
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

function InitializeSetup(): Boolean;
begin
  Result := EnsureChosenInstallDir();
  if not Result then
  begin
    MsgBox('YouTubePanel could not find a safe local install folder.' + #13#10 + #13#10 +
      'Windows error 448 means a path contains an untrusted junction or cloud placeholder.' + #13#10 +
      'Create a normal local folder and run setup again, for example:' + #13#10 +
      'C:\Users\Public\YouTubePanel',
      mbError, MB_OK);
    Exit;
  end;
  Result := DirExists(ExpandConstant('{userappdata}\BetterDiscord\plugins'));
  if not Result then
    MsgBox('BetterDiscord was not found.' + #13#10 + #13#10 +
      'Install and run BetterDiscord once, then run this setup again.' + #13#10 +
      'Expected folder: ' + ExpandConstant('{userappdata}\BetterDiscord\plugins'),
      mbError, MB_OK);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not CanUseInstallDir(WizardForm.DirEdit.Text) then
    begin
      MsgBox('That folder cannot be used.' + #13#10 + #13#10 +
        'It is a junction, a OneDrive/cloud path, or it is not writable.' + #13#10 +
        'Choose a normal local folder, for example:' + #13#10 +
        'C:\Users\Public\YouTubePanel',
        mbError, MB_OK);
      Result := False;
    end;
  end;
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
    if not CanUseInstallDir(ExpandConstant('{app}')) then
      RaiseException('YouTubePanel cannot install to this folder because it is a junction, a OneDrive/cloud path, or it is not writable. Choose a normal local folder such as C:\Users\Public\YouTubePanel.');
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
