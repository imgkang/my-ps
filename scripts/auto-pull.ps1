# MyPM 자동 git pull — 1회 실행 후 종료 (반복은 작업 스케줄러가 담당)
$repoPath = "C:\Users\강민구\mypm"
$envFile  = "$repoPath\scripts\.env"
$logFile  = "$repoPath\scripts\auto-pull.log"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^(\w+)=(.+)$') {
      Set-Variable -Name $matches[1] -Value $matches[2]
    }
  }
}

Set-Location $repoPath

$before = git rev-parse HEAD 2>$null
git fetch origin main 2>$null | Out-Null
$after  = git rev-parse origin/main 2>$null

if ($before -ne $after) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $logFile "$ts [PULL] $before -> $after"
    git pull origin main 2>&1 | Add-Content $logFile

    if ($CLOUDFLARE_ZONE_ID -and $CLOUDFLARE_API_TOKEN) {
      try {
        $cfResult = Invoke-RestMethod `
          -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" `
          -Method Post `
          -Headers @{ "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"; "Content-Type" = "application/json" } `
          -Body '{"purge_everything":true}'
        $status = if ($cfResult.success) { "[CF-PURGE] OK" } else { "[CF-PURGE] FAIL: $($cfResult.errors | ConvertTo-Json -Compress)" }
        Add-Content $logFile "$ts $status"
      } catch {
        Add-Content $logFile "$ts [CF-PURGE] ERROR: $_"
      }
    } else {
      Add-Content $logFile "$ts [CF-PURGE] SKIP: .env 없음 또는 토큰 미설정"
    }

    Add-Content $logFile "$ts [DONE]"
}
