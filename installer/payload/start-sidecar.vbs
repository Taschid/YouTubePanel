Option Explicit

' YouTubePanel sidecar fallback launcher.
'
' Windows logon startup uses PowerShell directly (see the Run key written by
' the installer), so Windows Script Host policy cannot break startup. This VBS
' remains only as a manual/legacy fallback for users who double-click it.
'
' It runs start-sidecar.ps1, which rebuilds PATH from the registry, drops
' untrusted junctions/reparse points, resolves the configured port, and starts
' node.exe hidden. This avoids Windows error 448 from yt-dlp walking a bad PATH
' entry.
'
' If PowerShell or the script cannot run, fall back to a direct launch with an
' allowlist PATH (never the inherited user PATH).

Dim fso, shell, base, ps1, psExe, cmd, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = base & "\start-sidecar.ps1"
psExe = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")

rc = 1
On Error Resume Next
If fso.FileExists(ps1) And fso.FileExists(psExe) Then
  cmd = """" & psExe & """ -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -InstallDir """ & base & """"
  rc = shell.Run(cmd, 0, True)
  If Err.Number <> 0 Then
    rc = 1
    Err.Clear
  End If
End If
On Error GoTo 0

If rc = 0 Then WScript.Quit 0

' ---------------------------------------------------------------- fallback
Dim nodeExe, sidecarJs
nodeExe = base & "\runtime\node.exe"
sidecarJs = base & "\sidecar.js"

If Not fso.FileExists(nodeExe) Then WScript.Quit 1
If Not fso.FileExists(sidecarJs) Then WScript.Quit 1

shell.CurrentDirectory = base
' Minimal allowlist PATH: bundled bin/runtime plus the system folders. No
' inherited user PATH, so a bad junction entry cannot break yt-dlp. sidecar.js
' reads the port and token from config.json.
shell.Environment("PROCESS")("PATH") = base & "\bin;" & base & "\runtime;" & _
  shell.ExpandEnvironmentStrings("%SystemRoot%\System32;%SystemRoot%")
shell.Run """" & nodeExe & """ """ & sidecarJs & """", 0, False
