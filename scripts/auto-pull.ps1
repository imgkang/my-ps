# MyPM 자동 git pull 서비스 — NSSM이 프로세스를 관리하므로 무한루프로 실행
$repoPath = "C:\Users\강민구\mypm"
$envFile  = "$repoPath\scripts\.env"
$logFile  = "$repoPath\scripts\auto-pull.log"
$interval = 60  # 초

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^(\w+)=(.+)$') {
      Set-Variable -Name $matches[1] -Value $matches[2]
    }
  }
}

Set-Location $repoPath

while ($true) {
    try {
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
            }

            Add-Content $logFile "$ts [DONE]"
        }
    } catch {
        $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content $logFile "$ts [ERROR] $_"
    }

    Start-Sleep -Seconds $interval
}
