Option Explicit

Dim fso, shell, base, nodeExe, sidecarJs
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = base & "\runtime\node.exe"
sidecarJs = base & "\sidecar.js"

If Not fso.FileExists(nodeExe) Then WScript.Quit 1
If Not fso.FileExists(sidecarJs) Then WScript.Quit 1

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = base
shell.Environment("PROCESS")("PATH") = base & "\bin;" & shell.Environment("PROCESS")("PATH")
shell.Run """" & nodeExe & """ """ & sidecarJs & """", 0, False
