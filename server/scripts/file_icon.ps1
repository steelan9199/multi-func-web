# file_icon.ps1 - generic icon helper for the file-icon function page.
# ASCII-only content (paths are passed as parameters, never embedded).
# Modes:
#   resolve   - print the TargetPath of an existing .lnk
#   setlnk    - change IconLocation of an existing .lnk
#   folder    - write desktop.ini IconResource for a folder (+ attrib)
#   createlnk - create a new .lnk with custom icon
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [string]$Target = "",
  [string]$Icon = "",
  [string]$Out = ""
)

$ErrorActionPreference = 'Stop'

function Escape-SingleQuotes([string]$s) {
  return $s.Replace("'", "''")
}

try {
  switch ($Mode) {
    'resolve' {
      $ws = New-Object -ComObject WScript.Shell
      $s = $ws.CreateShortcut($Target)
      Write-Output $s.TargetPath
    }
    'setlnk' {
      $ws = New-Object -ComObject WScript.Shell
      $s = $ws.CreateShortcut($Target)
      $s.IconLocation = "$Icon,0"
      $s.Save()
      Write-Output 'OK'
    }
    'folder' {
      $ini = Join-Path $Target 'desktop.ini'
      $lines = @()
      if (Test-Path -LiteralPath $ini) {
        $existing = Get-Content -LiteralPath $ini -ErrorAction SilentlyContinue
        if ($existing) {
          # keep other customizations, only drop stale IconResource lines
          $lines = @($existing | Where-Object { $_ -notmatch '^IconResource=' })
        }
      }
      $hasHeader = @($lines | Where-Object { $_ -match '^\[\.ShellClassInfo\]' }).Count -gt 0
      if (-not $hasHeader) { $lines = @('[.ShellClassInfo]') + $lines }
      $lines += "IconResource=$Icon,0"
      Set-Content -LiteralPath $ini -Value $lines -Encoding Unicode
      attrib.exe +S +H "$ini"
      attrib.exe +R "$Target"
      Write-Output 'OK'
    }
    'createlnk' {
      $ws = New-Object -ComObject WScript.Shell
      $s = $ws.CreateShortcut($Out)
      $s.TargetPath = $Target
      $s.IconLocation = "$Icon,0"
      $s.Save()
      Write-Output 'OK'
    }
    default {
      Write-Error "unknown mode: $Mode"
      exit 2
    }
  }
}
catch {
  Write-Error $_.Exception.Message
  exit 1
}
