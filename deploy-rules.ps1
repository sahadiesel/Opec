param(
  [string]$ProjectId = "studio-9554558161-dc547",
  [int]$MaxAttempts = 8,
  [int]$InitialDelaySeconds = 5,
  [int]$MaxDelaySeconds = 60
)

$ErrorActionPreference = "Stop"

function Run-Or-Fail {
  param(
    [string]$Command,
    [string]$ErrorMessage
  )
  Write-Host ">> $Command"
  Invoke-Expression $Command
  if ($LASTEXITCODE -ne 0) {
    throw $ErrorMessage
  }
}

Write-Host "== Firestore Rules Safe Deploy =="
Write-Host "Repo: $(Get-Location)"
Write-Host "Project: $ProjectId"

Run-Or-Fail "git rev-parse --is-inside-work-tree" "Current directory is not a git repository."
Run-Or-Fail "git switch main" "Failed to switch to main branch."
Run-Or-Fail "git fetch origin" "Failed to fetch from origin."
Run-Or-Fail "git pull --ff-only origin main" "Failed to fast-forward local main from origin/main."

$headHash = (git rev-parse --short HEAD).Trim()
$remoteHash = (git rev-parse --short origin/main).Trim()
Write-Host "Local HEAD:    $headHash"
Write-Host "origin/main:   $remoteHash"

if ($headHash -ne $remoteHash) {
  throw "Local HEAD does not match origin/main. Stop deploy."
}

$attempt = 0
$delay = $InitialDelaySeconds
$success = $false

while ($attempt -lt $MaxAttempts) {
  $attempt++
  Write-Host ""
  Write-Host "Deploy attempt $attempt/$MaxAttempts ..."

  firebase deploy --only firestore:rules --project $ProjectId
  if ($LASTEXITCODE -eq 0) {
    $success = $true
    break
  }

  if ($attempt -lt $MaxAttempts) {
    Write-Host "Deploy failed. Retrying in $delay second(s)..."
    Start-Sleep -Seconds $delay
    $delay = [Math]::Min($delay * 2, $MaxDelaySeconds)
  }
}

if (-not $success) {
  throw "Deploy failed after $MaxAttempts attempts."
}

Write-Host ""
Write-Host "Deploy completed successfully."
Write-Host "Next: verify latest version in Firebase Console > Firestore > Rules."

