<#
Build the site and publish it to Cloudflare.

    powershell -File deploy.ps1

Two steps, in this order, and the order is the whole point: `wrangler deploy`
uploads whatever happens to be in out\, so deploying without building first
publishes whatever the last build left lying there. That stale deploy is the
one mistake this script exists to make impossible -- it always rebuilds.

If the build fails, nothing is deployed.

Needs two things that are not in the repo, both for the same reason (the build
reads the game's own 869 MB archive, so it cannot run in CI):

  * Torchlight II installed, or TL2_GAME_DIR pointing at it
  * wrangler installed and authenticated -- `wrangler login` once

See REFERENCE.md section 7 for the build itself and wrangler.jsonc for what
gets uploaded.
#>
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "`n=== build ===" -ForegroundColor Cyan
    python src\build.py
    if ($LASTEXITCODE -ne 0) {
        throw "build failed -- nothing deployed"
    }

    Write-Host "`n=== deploy ===" -ForegroundColor Cyan
    wrangler deploy
    if ($LASTEXITCODE -ne 0) {
        throw "deploy failed"
    }

    Write-Host "`nhttps://tl2db.hreddy.in`n" -ForegroundColor Green
}
finally {
    Pop-Location
}
