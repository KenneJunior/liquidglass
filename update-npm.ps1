<#
.SYNOPSIS
    Defensive, zero-drama npm release & publish pipeline.

.DESCRIPTION
    Runs pre-flight checks (git, auth, remote sync), lint/test/build,
    bumps the package version, publishes to npm, and syncs the release
    back to git. Every native call is checked, every failure mode has
    a clear recovery path, and -DryRun previews the real publish
    payload via `npm publish --dry-run` — nothing fake, nothing skipped
    silently.

.PARAMETER Bump
    Version bump type passed straight to `npm version`. Default: patch.

.PARAMETER PreId
    Prerelease identifier (e.g. 'beta', 'rc') for pre* bump types.

.PARAMETER Message
    Release message. Supplying this skips the interactive prompt —
    use it to keep the script non-interactive in CI.

.PARAMETER Otp
    One-time password, forwarded to `npm publish --otp` for accounts
    with 2FA required on publish.

.PARAMETER SkipTests
    Skip lint, test, and build entirely.

.PARAMETER DryRun
    Preview every step with zero side effects. Publish still runs for
    real via `npm publish --dry-run` so you see the exact file list
    npm would ship. Nothing is committed, tagged, published, or pushed.

.PARAMETER Yes
    Non-interactive mode. Auto-confirms safe prompts and never blocks
    on Read-Host. Use in CI — a script that hangs waiting for a human
    who isn't there is worse than one that just fails loudly.

.PARAMETER NoPush
    Publish to npm but skip the final `git push`.

.EXAMPLE
    ./release.ps1
.EXAMPLE
    ./release.ps1 -Bump minor -Message "add dark mode"
.EXAMPLE
    ./release.ps1 -Bump prerelease -PreId beta -Yes
.EXAMPLE
    ./release.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor', 'prerelease')]
  [string]$Bump = 'patch',

  [string]$PreId,
  [string]$Message,
  [string]$Otp,

  [switch]$SkipTests,
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$NoPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# ── UI helpers ──────────────────────────────────────────────────────
function Write-Banner {
  # 1. Attempt to read package details for personalization
  $pkgName = "Local Package"
  $pkgVersion = "v0.0.0"
  $gitName = (git remote -v)
  if ($gitName) {
    $gitName = $gitName.Split("`n")[0] -replace '\s+\(fetch\)$', '' -replace '\s+\(push\)$', ''
  }
  if (Test-Path package.json) {
    $pkg = Get-Content package.json -Raw | ConvertFrom-Json
    if ($pkg.name) { $pkgName = $pkg.name }
    if ($pkg.version) { $pkgVersion = "v" + $pkg.version }
  }

  Clear-Host
  Write-Host "`n"

  # 2. Render the dual-tone, perfectly aligned banner
  Write-Host "    _   ______  __  ___ " -ForegroundColor Cyan -NoNewline
  Write-Host "   NPM RELEASE PIPELINE" -ForegroundColor White

  Write-Host "   / | / / __ \/  |/  / " -ForegroundColor Cyan -NoNewline
  Write-Host "   ───────────────────────────────" -ForegroundColor DarkGray

  Write-Host "  /  |/ / /_/ / /|_/ /  " -ForegroundColor Cyan -NoNewline
  Write-Host "   📦 $pkgName " -ForegroundColor Yellow -NoNewline
  Write-Host "[$pkgVersion]" -ForegroundColor Green

  Write-Host " / /|  / ____/ /  / /   " -ForegroundColor Cyan -NoNewline
  Write-Host "   🚀 $gitName" -ForegroundColor Gray

  Write-Host "/_/ |_/_/   /_/  /_/    " -ForegroundColor Cyan -NoNewline
  Write-Host "   ⚡ Automated & Secure" -ForegroundColor DarkGray

  Write-Host "`n"
}

function Write-Header ([string]$Text) {
  $pad = [Math]::Max(0, 46 - $Text.Length)
  Write-Host "`n🚀 $Text " -ForegroundColor Cyan -NoNewline
  Write-Host ("─" * $pad) -ForegroundColor DarkGray
}
function Write-Step    ([string]$Text) { Write-Host "➡️  $Text" -ForegroundColor Blue }
function Write-Success ([string]$Text) { Write-Host "✅  $Text" -ForegroundColor Green }
function Write-Warn    ([string]$Text) { Write-Host "⚠️  $Text" -ForegroundColor Yellow }
function Write-Fail    ([string]$Text) { Write-Host "❌  $Text" -ForegroundColor Red }
function Write-Info    ([string]$Text) { Write-Host "   $Text" -ForegroundColor DarkGray }

function Format-Duration ([TimeSpan]$Span) {
  if ($Span.TotalMinutes -ge 1) { return "{0}m {1}s" -f [int]$Span.Minutes, $Span.Seconds }
  return "{0:N1}s" -f $Span.TotalSeconds
}

function Test-CommandExists ([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Action {
  param([string]$Prompt, [switch]$DefaultYes)
  if ($Yes) { return $true }
  $suffix = if ($DefaultYes) { '(Y/n)' } else { '(y/N)' }
  $resp = Read-Host "   $Prompt $suffix"
  if ([string]::IsNullOrWhiteSpace($resp)) { return $DefaultYes.IsPresent }
  return $resp.Trim().ToLower() -eq 'y'
}

function Get-SafeMessage ([string]$Text) {
  return ($Text -replace '"', "'" -replace '[\r\n]+', ' ').Trim()
}

# Runs a native command, checks $LASTEXITCODE (native exes don't throw
# on failure even with $ErrorActionPreference = 'Stop'), and times it.
function Invoke-Timed {
  param(
    [Parameter(Mandatory)][scriptblock]$Command,
    [Parameter(Mandatory)][string]$FailMessage,
    [string]$SuccessMessage,
    [switch]$FailIsFatal = $true
  )
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $Command
  $code = $LASTEXITCODE
  $sw.Stop()
  if ($code -ne 0) {
    Write-Fail "$FailMessage (exit $code)"
    if ($FailIsFatal) { exit $code }
    return $false
  }
  if ($SuccessMessage) {
    Write-Success "$SuccessMessage ($(Format-Duration $sw.Elapsed))"
  }
  return $true
}

# ── Main ─────────────────────────────────────────────────────────────
try {
  Clear-Host
  Write-Banner
  if ($DryRun) { Write-Warn "DRY-RUN mode — publish will use npm's own --dry-run, nothing else touches disk, git, or the registry.`n" }

  # 1. Environment & pre-flight ------------------------------------------------
  Write-Header "Pre-flight Checks"

  foreach ($cmd in @('git', 'npm')) {
    if (-not (Test-CommandExists $cmd)) {
      Write-Fail "'$cmd' is not installed or not on PATH."
      exit 1
    }
  }

  Write-Step "Verifying Git repository..."
  $null = git rev-parse --is-inside-work-tree 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Fail "Current directory is not a Git repository."; exit 1 }

  $branch = (git rev-parse --abbrev-ref HEAD 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $branch) {
    Write-Fail "Could not determine current branch — does this repo have any commits yet?"
    exit 1
  }
  $branch = $branch.Trim()
  if ($branch -eq 'HEAD') {
    Write-Fail "Detached HEAD state — checkout a branch before releasing."
    exit 1
  }

  $null = git remote get-url origin 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "No 'origin' remote configured. Add one with: git remote add origin <url>"
    exit 1
  }

  Write-Step "Checking sync with origin/$branch..."
  git fetch origin $branch --quiet *> $null
  if ($LASTEXITCODE -eq 0) {
    $behind = (git rev-list --count "HEAD..origin/$branch" 2>$null)
    if ($LASTEXITCODE -eq 0 -and $behind -match '^\d+$' -and [int]$behind -gt 0) {
      Write-Warn "Local branch is $behind commit(s) behind origin/$branch."
      if (-not (Confirm-Action "Continue anyway?")) { Write-Fail "Aborted by user."; exit 1 }
    }
  } else {
    Write-Info "origin/$branch not found upstream yet — skipping sync check."
  }

  Write-Step "Checking working tree..."
  $porcelain = (git status --porcelain)
  if ($porcelain) {
    Write-Warn "Working tree has uncommitted changes:"
    Write-Host $porcelain -ForegroundColor DarkGray
    if (-not (Confirm-Action "Continue anyway?")) { Write-Fail "Aborted by user."; exit 1 }
  }

  Write-Step "Verifying npm authentication..."
  $npmUser = (npm whoami 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $npmUser) {
    Write-Fail "Not logged into npm. Run 'npm login' and try again."
    exit 1
  }
  $npmUser = $npmUser.Trim()
  $registry = (npm config get registry 2>$null)
  $registry = if ($registry) { $registry.Trim() } else { '(unknown)' }
  Write-Success "Authenticated as '$npmUser' on Git and NPM."
  Write-Info "Registry: $registry"

  # 2. Package inspection -------------------------------------------------------
  Write-Header "Package Inspection"
  if (-not (Test-Path package.json)) {
    Write-Fail "package.json not found in the current directory."
    exit 1
  }

  try {
    $rawPkg = Get-Content package.json -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
  } catch {
    Write-Fail "package.json is not valid JSON: $($_.Exception.Message)"
    exit 1
  }
  $pkg = $rawPkg | Select-Object name, version, private, files, scripts

  if ([string]::IsNullOrWhiteSpace($pkg.name)) { Write-Fail "package.json is missing a 'name' field."; exit 1 }
  if ([string]::IsNullOrWhiteSpace($pkg.version)) { Write-Fail "package.json is missing a 'version' field."; exit 1 }

  $pkgName = $pkg.name
  $pkgVersion = $pkg.version
  $isScoped = $pkgName.StartsWith('@')
  $isPrivate = $pkg.private -eq $true

  Write-Success "Found package: $pkgName (v$pkgVersion)"
  if ($pkgVersion -notmatch '^\d+\.\d+\.\d+') {
    Write-Warn "Version '$pkgVersion' doesn't look like standard semver."
  }
  if ($isPrivate) {
    Write-Warn "Package is marked 'private' — it will not be published to the registry."
  }
  if (-not $isPrivate -and -not $pkg.files -and -not (Test-Path .npmignore)) {
    Write-Warn "No 'files' field and no .npmignore — npm will publish everything not gitignored."
  }

  # 3. Lint, test & build --------------------------------------------------------
  Write-Header "Build & Validation"
  if ($SkipTests) {
    Write-Warn "Skipping lint, tests, and build (-SkipTests)."
  } else {
    $scripts = if ($null -ne $pkg.scripts) { $pkg.scripts | Select-Object lint, test, build } else { $null }

    if ($scripts -and $scripts.lint) {
      Write-Step "Running linter..."
      Invoke-Timed -Command { npm run lint } -FailMessage "Lint failed. Aborting release." -SuccessMessage "Lint passed" | Out-Null
    } else {
      Write-Info "No 'lint' script found. Skipping."
    }

    if ($scripts -and $scripts.test) {
      Write-Step "Running test suite..."
      Invoke-Timed -Command { npm test } -FailMessage "Tests failed. Aborting release." -SuccessMessage "Tests passed" | Out-Null
    } else {
      Write-Info "No 'test' script found. Skipping."
    }

    if ($scripts -and $scripts.build) {
      Write-Step "Building package..."
      Invoke-Timed -Command { npm run build } -FailMessage "Build failed. Aborting release." -SuccessMessage "Build successful" | Out-Null
    } else {
      Write-Info "No 'build' script found. Skipping."
    }
  }

  # 4. Version bump ---------------------------------------------------------------
  Write-Header "Version Release"

  if ($Bump -in @('major', 'premajor') -and -not (Confirm-Action "Bump type is '$Bump' — a breaking-change release. Continue?")) {
    Write-Fail "Aborted by user."
    exit 1
  }

  if (-not $Message -and -not $Yes) {
    $Message = Read-Host "💬 Enter release message (short) [default: $Bump bump]"
  }
  if ([string]::IsNullOrWhiteSpace($Message)) { $Message = "$Bump bump" }
  $safeMessage = Get-SafeMessage $Message

  $versionArgs = @('version', $Bump)
  if ($PreId) { $versionArgs += @('--preid', $PreId) }
  $versionArgs += @('-m', "release: %s - $safeMessage")

  Write-Step "Bumping $Bump version..."
  if ($DryRun) {
    Write-Info "[DryRun] npm $($versionArgs -join ' ')"
    $newVersion = $pkgVersion
  } else {
    $ok = Invoke-Timed -Command { npm @versionArgs } -FailMessage "Failed to bump version." -SuccessMessage "Version bumped"
    if (-not $ok) { exit $LASTEXITCODE }
    $newPkg = Get-Content package.json -Raw | ConvertFrom-Json
    $newVersion = $newPkg.version
    Write-Success "v$pkgVersion → v$newVersion"
  }

  # 5. Publish ----------------------------------------------------------------------
  Write-Header "Publishing"
  $publishArgs = @('publish')
  if ($isScoped -and -not $isPrivate) { $publishArgs += @('--access', 'public') }
  if ($Otp) { $publishArgs += @('--otp', $Otp) }
  if ($DryRun) { $publishArgs += '--dry-run' }

  Write-Step "Publishing to $registry ..."
  $published = Invoke-Timed -Command { npm @publishArgs } `
    -FailMessage "Failed to publish to npm." -SuccessMessage "Published" -FailIsFatal:$false

  if (-not $published) {
    if (-not $DryRun) {
      Write-Warn "Local commit & tag for v$newVersion were created but NOT published."
      Write-Info "Retry:    npm publish"
      Write-Info "Rollback: git reset --hard HEAD~1; git tag -d v$newVersion"
    }
    exit 1
  }

  # 6. Push to git --------------------------------------------------------------------
  Write-Header "Git Sync"
  if ($NoPush) {
    Write-Warn "Skipping git push (-NoPush). Push manually when ready:"
    Write-Info "git push origin $branch --follow-tags"
  } elseif ($DryRun) {
    Write-Info "[DryRun] git push origin $branch --follow-tags"
  } else {
    Write-Step "Pushing commits and tags to origin/$branch..."
    $pushed = Invoke-Timed -Command { git push origin $branch --follow-tags } `
      -FailMessage "Failed to push to remote." -SuccessMessage "Pushed" -FailIsFatal:$false
    if (-not $pushed) {
      Write-Warn "Package v$newVersion published successfully, but the git push failed."
      Write-Info "Push manually: git push origin $branch --follow-tags"
      exit 1
    }
  }

  # 7. Summary --------------------------------------------------------------------------
  Write-Header "Done"
  $elapsed = Format-Duration $script:Stopwatch.Elapsed
  Write-Success "Release completed successfully! 🎉"
  Write-Host ""
  Write-Host "   package    " -NoNewline -ForegroundColor DarkGray; Write-Host $pkgName -ForegroundColor White
  Write-Host "   version    " -NoNewline -ForegroundColor DarkGray; Write-Host "v$pkgVersion → v$newVersion" -ForegroundColor White
  Write-Host "   branch     " -NoNewline -ForegroundColor DarkGray; Write-Host $branch -ForegroundColor White
  Write-Host "   registry   " -NoNewline -ForegroundColor DarkGray; Write-Host $registry -ForegroundColor White
  Write-Host "   time       " -NoNewline -ForegroundColor DarkGray; Write-Host $elapsed -ForegroundColor White
  Write-Host ""
  exit 0

} catch {
  Write-Fail "Unexpected error: $($_.Exception.Message)"
  exit 1
} finally {
  [Console]::ResetColor()
}