# mypm.growpension.com 배포 가이드

## 배포 구조

```
GitHub (main 브랜치)
    ↓ git pull (집 PC 수동 or 자동)
집 Windows PC (C:\Users\강민구\mypm\)
    ↓ Fastify 정적 서빙 (server/, SERVE_STATIC=true)
Cloudflare Tunnel (cloudflared)
    ↓
mypm.growpension.com
```

**핵심**: GitHub Pages가 아님. 집 PC 로컬 저장소 파일을 Node 서버가 직접 서빙.  
main에 머지해도 집 PC에서 `git pull` 해야 실제 사이트에 반영된다.

---

## Claude가 자동으로 처리하는 것

- 버전 번호 올리기 (`index.html` / `NonK.html` / `KDeal.html` / `sw.js`)
- 작업 브랜치 커밋·푸시
- Draft PR 생성
- "메인에 업데이트" 요청 시 PR → main 머지

---

## 사용자가 해야 하는 것

### A. 집에 있을 때 (기본)

```powershell
cd C:\Users\강민구\mypm
git pull
```

정적 파일(HTML/sw.js)만 바뀐 경우 서버 재시작 불필요 — git pull 즉시 반영.  
`server/src/` TypeScript 코드가 바뀐 경우에만:
```powershell
cd server
npm run build
nssm restart MyPMBackend   # 또는 작업 스케줄러에서 재시작
```

### B. Cloudflare 캐시 퍼지 (선택 — 즉시 반영 원할 때)

Cloudflare가 sw.js를 최대 4시간 캐싱함.  
즉시 반영하려면: **Cloudflare 대시보드 → growpension.com → Caching → Purge Everything**

또는 PowerShell로 확인:
```powershell
(Invoke-WebRequest -Uri "https://mypm.growpension.com/sw.js" -Headers @{"Cache-Control"="no-cache"} -UseBasicParsing).Content | Select-String "mypm-v0"
```

### C. 브라우저 강제 새로고침

```
Ctrl+Shift+R
```

> ⚠️ F12 → Application → "Clear site data" 는 **localStorage(자산 데이터)까지 삭제**되므로 금지.  
> Cache Storage만 개별 삭제하거나, Network 탭 "Disable cache" + Ctrl+Shift+R 사용.

---

## 집 밖에서 업데이트하는 방법

### 방법 1. 자동 git pull 스크립트 (권장)

집 PC에 Windows 작업 스케줄러로 자동 pull 설정.  
→ main 머지 후 최대 10분 이내 자동 반영, 수동 작업 불필요.

**설정 방법**: 아래 `scripts/auto-pull.ps1` 작성 후 작업 스케줄러 등록 (한 번만 설정).

`scripts/auto-pull.ps1` 파일 내용:
```powershell
# MyPM 자동 git pull 스크립트
$repoPath = "C:\Users\강민구\mypm"
$logFile  = "$repoPath\scripts\auto-pull.log"

Set-Location $repoPath

$before = git rev-parse HEAD
git fetch origin main 2>&1 | Out-Null
$after  = git rev-parse origin/main

if ($before -ne $after) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content $logFile "$ts [PULL] $before -> $after"
    git pull origin main 2>&1 | Add-Content $logFile
} 
# 변경 없으면 조용히 종료 (로그 없음)
```

**작업 스케줄러 등록** (PowerShell 관리자 권한):
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-NonInteractive -File C:\Users\강민구\mypm\scripts\auto-pull.ps1"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 10) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -RunOnlyIfNetworkAvailable -StartWhenAvailable
Register-ScheduledTask -TaskName "MyPM-AutoPull" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

등록 확인: `Get-ScheduledTask -TaskName "MyPM-AutoPull"`  
로그 확인: `Get-Content C:\Users\강민구\mypm\scripts\auto-pull.log -Tail 20`

---

### 방법 2. 원격 데스크톱(RDP)

가장 간단. 집 PC에 RDP 활성화 후 외부에서 접속해 직접 `git pull`.

- 설정: Windows 설정 → 시스템 → 원격 데스크톱 → 활성화
- 접속: `mstsc` (Microsoft Remote Desktop) 또는 모바일 앱
- 주소: cloudflared tunnel이 이미 있으므로 RDP over SSH tunnel도 가능

---

### 방법 3. SSH over Cloudflare Tunnel

cloudflared가 이미 실행 중이므로 SSH 접속 채널 추가 가능.  
집 PC에서 설정 (관리자 PowerShell):
```powershell
# OpenSSH 서버 설치
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
```

cloudflared config에 SSH 인그레스 추가 (`%USERPROFILE%\.cloudflared\config.yml`):
```yaml
ingress:
  - hostname: mypm.growpension.com
    service: http://localhost:3000
  - hostname: ssh.growpension.com    # 새 서브도메인 추가
    service: ssh://localhost:22
  - service: http_status:404
```

```powershell
# Cloudflare DNS에 ssh 서브도메인 라우팅 추가 (한 번만)
cloudflared tunnel route dns mypm ssh.growpension.com
cloudflared service restart
```

이후 어디서든:
```bash
ssh -o "ProxyCommand cloudflared access ssh --hostname ssh.growpension.com" 강민구@ssh.growpension.com
# 접속 후
cd C:\Users\강민구\mypm && git pull
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| 사이트 업데이트 안 됨 | 집 PC git pull 안 함 | `git pull` 실행 |
| pull 했는데도 옛날 버전 | Cloudflare 캐시 | Purge Everything |
| Purge 해도 옛날 버전 | 브라우저 SW 캐시 | Ctrl+Shift+R |
| 사이트 자체가 안 열림 | cloudflared 또는 서버 중단 | 집 PC에서 서비스 확인 |
| 서버 확인 | — | `https://mypm.growpension.com/api/health` → `{"ok":true}` |
