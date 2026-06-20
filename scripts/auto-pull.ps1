# MyPM 자동 git pull — 10초 간격 무한 루프
$repoPath = "C:\Users\강민구\mypm"
$envFile  = "$repoPath\scripts\.env"
$logFile  = "$repoPath\scripts\auto-pull.log"

# .env 파일에서 토큰 읽기
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^(\w+)=(.+)$') {
      Set-Variable -Name $matches[1] -Value $matches[2]
    }
  }
}

Set-Location $repoPath

while ($true) {
    $before = git rev-parse HEAD 2>$null
    git fetch origin main 2>$null | Out-Null
    $after  = git rev-parse origin/main 2>$null

    if ($before -ne $after) {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content $logFile "$ts [PULL] $before -> $after"
        git pull origin main 2>&1 | Add-Content $logFile

        if ($CLOUDFLARE_ZONE_ID -and $CLOUDFLARE_API_TOKEN) {
          Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" `
            -Method Post `
            -Headers @{ "Authorization" = "Bearer $CLOUDFLARE_API_TOKEN"; "Content-Type" = "application/json" } `
            -Body '{"purge_everything":true}' | Out-Null
        }

        Add-Content $logFile "$ts [DONE]"
    }

    Start-Sleep -Seconds 10
}