# MyPM 자동 git pull 스크립트
# 작업 스케줄러로 10분마다 실행 — main에 새 커밋이 있을 때만 pull
# 등록 방법: docs/DEPLOY.md 참고

$repoPath = "C:\Users\강민구\mypm"
$logFile  = "$repoPath\scripts\auto-pull.log"

Set-Location $repoPath

$before = git rev-parse HEAD 2>$null
git fetch origin main 2>$null | Out-Null
$after  = git rev-parse origin/main 2>$null

if ($before -ne $after) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $logFile "$ts [PULL] $before -> $after"
    git pull origin main 2>&1 | Add-Content $logFile
    Add-Content $logFile "$ts [DONE]"
}
# 변경 없으면 조용히 종료
