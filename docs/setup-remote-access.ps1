# =============================================================
# 원격 접속 환경 설정 스크립트
# 집 PC에서 관리자 PowerShell로 실행
#
# 완료 후 가능한 것:
#   1) ssh.growpension.com 으로 어디서든 SSH 접속
#   2) https://mypm.growpension.com/api/update?token=... 로 강제 배포
# =============================================================

$ErrorActionPreference = 'Stop'

# ── 설정값 (여기만 바꾸세요) ──────────────────────────────────
$TUNNEL_NAME      = 'mypm'
$CF_CONFIG        = 'C:\Users\강민구\.cloudflared\config.yml'
$MYPM_ROOT        = 'C:\Users\강민구\mypm'
$SSH_HOSTNAME     = 'ssh.growpension.com'
$UPDATE_TOKEN     = -join ((65..90)+(97..122)+(48..57) | Get-Random -Count 24 | % {[char]$_})
# ─────────────────────────────────────────────────────────────

Write-Host "`n[1/5] OpenSSH 서버 설치 중..." -ForegroundColor Cyan
$cap = Get-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
if ($cap.State -ne 'Installed') {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
    Write-Host "  설치 완료" -ForegroundColor Green
} else {
    Write-Host "  이미 설치됨" -ForegroundColor Yellow
}

Write-Host "`n[2/5] sshd 서비스 자동시작 설정..." -ForegroundColor Cyan
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Write-Host "  sshd 실행 중" -ForegroundColor Green

Write-Host "`n[3/5] cloudflared config 에 SSH 인그레스 추가..." -ForegroundColor Cyan
$cfg = Get-Content $CF_CONFIG -Raw
if ($cfg -notmatch 'ssh://localhost:22') {
    # 마지막 catch-all 앞에 SSH 인그레스 삽입
    $newEntry = "  - hostname: $SSH_HOSTNAME`r`n    service: ssh://localhost:22`r`n"
    $cfg = $cfg -replace '(?m)(^  - service: http_status)', "$newEntry  - service: http_status"
    Set-Content $CF_CONFIG $cfg -Encoding UTF8
    Write-Host "  config 업데이트 완료" -ForegroundColor Green
} else {
    Write-Host "  이미 설정됨" -ForegroundColor Yellow
}

Write-Host "`n[4/5] Cloudflare DNS 라우팅 ($SSH_HOSTNAME)..." -ForegroundColor Cyan
try {
    cloudflared tunnel route dns $TUNNEL_NAME $SSH_HOSTNAME
    Write-Host "  DNS 등록 완료" -ForegroundColor Green
} catch {
    Write-Host "  이미 등록됐거나 수동 확인 필요: $_" -ForegroundColor Yellow
}

Write-Host "`n[5/5] MyPMTunnel 재시작..." -ForegroundColor Cyan
Stop-ScheduledTask MyPMTunnel
Start-Sleep 2
Start-ScheduledTask MyPMTunnel
Write-Host "  완료" -ForegroundColor Green

Write-Host "`n[보너스] UPDATE_TOKEN .env 에 추가..." -ForegroundColor Cyan
$envFile = "$MYPM_ROOT\server\.env"
$envContent = Get-Content $envFile -Raw
if ($envContent -notmatch 'UPDATE_TOKEN') {
    Add-Content $envFile "`nUPDATE_TOKEN=$UPDATE_TOKEN"
    Write-Host "  추가 완료 (토큰: $UPDATE_TOKEN)" -ForegroundColor Green
} else {
    $UPDATE_TOKEN = ($envContent | Select-String 'UPDATE_TOKEN=(.+)').Matches[0].Groups[1].Value.Trim()
    Write-Host "  이미 설정됨 (토큰: $UPDATE_TOKEN)" -ForegroundColor Yellow
}

Write-Host "`n서버 재빌드 및 재시작..." -ForegroundColor Cyan
Push-Location "$MYPM_ROOT\server"
npm run build
Pop-Location
Stop-ScheduledTask MyPMBackend
Start-Sleep 2
Start-ScheduledTask MyPMBackend
Write-Host "  완료" -ForegroundColor Green

# ── 결과 출력 ──────────────────────────────────────────────
Write-Host "`n============================================" -ForegroundColor Magenta
Write-Host " 원격 접속 설정 완료!" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "1. SSH 접속 (cloudflared 설치된 기기에서):"
Write-Host "   ssh -o `"ProxyCommand cloudflared access ssh --hostname $SSH_HOSTNAME`" 강민구@$SSH_HOSTNAME" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. 원격 강제 배포 URL (북마크 해두세요):"
Write-Host "   https://mypm.growpension.com/api/update?token=$UPDATE_TOKEN" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. git remote 확인 (SSH면 HTTPS로 변경 권장):" -ForegroundColor Yellow
Write-Host "   git -C $MYPM_ROOT remote -v"
Write-Host "   # git@github.com:... 이면 아래 실행:"
Write-Host "   git -C $MYPM_ROOT remote set-url origin https://github.com/imgkang/my-ps.git" -ForegroundColor Cyan
Write-Host ""
