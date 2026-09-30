' Hidden launcher for the saas-platform dev server.
' Purpose: run `npm run dev:all` fully detached from the caller's console so
' session teardown (Ctrl+C broadcast) can never kill the dev server.
' Logs: server-dev.log in saas-platform.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Resolve script dir regardless of working directory.
Dim here
here = fso.GetParentFolderName(WScript.ScriptFullName)

' Kill any previous instance listening on :3000 (best effort, no errors shown).
sh.Run "cmd /c powershell -NoProfile -Command ""Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True

' Launch the dev server in its own hidden, detached console.
' cmd /c exits immediately after npm finishes; output goes to the log file.
' here = ...\saas-platform\scripts → parent is the saas-platform root.
sh.CurrentDirectory = fso.GetParentFolderName(here)
sh.Run "cmd /c npm run dev:all > server-dev.log 2>&1", 0, False

Set sh = Nothing
Set fso = Nothing
