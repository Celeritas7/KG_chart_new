# Reorganise KG_chart_new into a clean layout. Safe to run twice.
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File tools\reorganize.ps1          <- preview only
#   powershell -ExecutionPolicy Bypass -File tools\reorganize.ps1 -Apply   <- do it
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path 'index.html') -or -not (Test-Path '.git')) { Write-Host 'Put this file in KG_chart_new\tools\ and run it again.'; exit 1 }
$git = [bool](Get-Command git -ErrorAction SilentlyContinue)
if (-not $git) { Write-Host 'git not found: files will be moved, but git will see them as deleted + new.' }
Write-Host ($(if ($Apply) { "APPLYING changes in $PWD" } else { "PREVIEW (nothing changes). Add -Apply to do it. Folder: $PWD" }))

function Is-Tracked($p) {
  if (-not $git) { return $false }
  $out = git ls-files -- $p 2>$null
  return [bool]$out
}
function Ensure-Parent($dst) {
  $parent = Split-Path $dst -Parent
  if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
}
# Move and keep in git
function Move-Keep($src, $dst) {
  if (-not (Test-Path -LiteralPath $src)) { return }
  if (Test-Path -LiteralPath $dst) { Write-Host "  skip, already there: $dst"; return }
  Write-Host "  $src  ->  $dst"
  if (-not $Apply) { return }
  Ensure-Parent $dst
  if (Is-Tracked $src) { git mv -- $src $dst } else { Move-Item -LiteralPath $src -Destination $dst }
}
# Move into a local-only folder and take it out of git (files stay on disk)
function Move-Local($src, $dst) {
  if (-not (Test-Path -LiteralPath $src)) { return }
  if (Test-Path -LiteralPath $dst) { Write-Host "  skip, already there: $dst"; return }
  Write-Host "  $src  ->  $dst   (local only, not in git)"
  if (-not $Apply) { return }
  $tracked = Is-Tracked $src
  Ensure-Parent $dst
  Move-Item -LiteralPath $src -Destination $dst
  if ($tracked) { git rm -r --cached --quiet --ignore-unmatch -- $src | Out-Null }
}

Write-Host "`n1. Node tools -> tools\"
Move-Keep 'kg-serve.js'      'tools\kg-serve.js'
Move-Keep 'upload_images.js' 'tools\upload_images.js'

Write-Host "`n2. Notes and plans -> docs\"
foreach ($f in 'audio-plan.md','image-prompt.md','keep-sentences.md','Kaizen.txt','burmese-regression-diff.html','typing-plan.md','marathi-plan.md','unlock-rules-plan.md','roadmap.md') { Move-Keep $f "docs\$f" }

Write-Host "`n3. SQL -> sql\"
Get-ChildItem -File -Filter *.sql | ForEach-Object { Move-Keep $_.Name "sql\$($_.Name)" }

Write-Host "`n4. Data -> data\"
Get-ChildItem -File -Filter *.csv | ForEach-Object { Move-Keep $_.Name "data\$($_.Name)" }

Write-Host "`n5. README.md (was overwritten by the Phase 10 notes)"
if ((Test-Path 'README.md') -and ((Get-Content 'README.md' -TotalCount 1) -match 'Phase 10')) {
  $headFirst = if ($git) { (git show HEAD:README.md 2>$null | Select-Object -First 1) } else { $null }
  Write-Host "  README.md  ->  docs\phase10-type-the-word.md"
  if ($Apply) {
    Ensure-Parent 'docs\x'
    Copy-Item 'README.md' 'docs\phase10-type-the-word.md' -Force
    if ($headFirst -and $headFirst -notmatch 'Phase 10') { git checkout HEAD -- README.md; Write-Host '  restored the project README from the last commit' }
    else { Write-Host '  NOTE: the last commit also has the Phase 10 README. Find the old one with: git log --oneline -- README.md' }
  }
}

Write-Host "`n6. Old versions and unused files -> archive\ (local only)"
Move-Local 'Temp'                  'archive\old-versions'
Move-Local 'js\languages'          'archive\js-languages-unused'
Move-Local 'kg-chart-admin\burmese_devanagari_tester111.html' 'archive\burmese_devanagari_tester111.html'

Write-Host "`n7. Local working files: kg-chart-admin\ -> workspace\ (local only; name clashed with kg-chart-admin.html)"
Move-Local 'kg-chart-admin' 'workspace'

Write-Host "`n8. run-kg-chart.bat: point at tools\kg-serve.js"
$bat = Get-Content 'run-kg-chart.bat' -Raw
if ($bat -notmatch 'tools\\kg-serve\.js') {
  Write-Host '  update kg-serve.js -> tools\kg-serve.js'
  if ($Apply) { Set-Content 'run-kg-chart.bat' ($bat -replace 'kg-serve\.js', 'tools\kg-serve.js').TrimEnd() -Encoding ASCII }
}

Write-Host "`n9. .gitignore"
$ignore = @('node_modules/','images/','audio-cache/','__pycache__/','archive/','workspace/','Temp/','kg-chart-admin/','.env')
$have = if (Test-Path '.gitignore') { Get-Content '.gitignore' } else { @() }
$add = $ignore | Where-Object { $have -notcontains $_ }
if ($add) { Write-Host "  add: $($add -join ' ')"; if ($Apply) { Add-Content '.gitignore' $add } }

Write-Host "`nDone." -ForegroundColor Green
if ($Apply) {
  Write-Host 'Check:  double-click run-kg-chart.bat -> app + admin open.  python tools\gen_kg_audio.py --dry-run still works.'
  Write-Host 'Then:   git add -A ; git commit -m "Reorganise folders" ; git push'
}
