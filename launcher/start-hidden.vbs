' Starts the Erechear game server with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
launcherDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = "node"
If fso.FileExists(sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe") Then
  nodeExe = """" & sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"""
End If
sh.CurrentDirectory = launcherDir
sh.Run nodeExe & " """ & launcherDir & "\server.js""", 0, False
