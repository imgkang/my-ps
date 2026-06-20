# mypm.growpension.com 배포 가이드

## 배포 구조

```
git push origin main
    ↓ GitHub Webhook (즉시)
집 Windows PC — POST /api/github-webhook 수신
    ↓ git pull + Cloudflare 캐시 퍼지 자동 실행
mypm.growpension.com (반영 완료)
```

**핵심**: GitHub Pages가 아님. 집 PC 로컬 저장소 파일을 Node 서버가 직접 서빙.  
push 후 Webhook이 자동으로 git pull + CF purge까지 처리. 수동 작업 불필요.

---

## Claude가 자동으로 처리하는 것

- 버전 번호 올리기 (`index.html` / `NonK.html` / `KDeal.html` / `sw.js`)
- 커밋 후 `git show HEAD:index.html | grep APP_VERSION` 으로 실제 커밋 내용 검증
- main 커밋·푸시

---

## 사용자가 해야 하는 것

### A. 평상시 — 브라우저 새로고침만

push 후 Webhook이 자동으로 git pull + CF purge 실행.  
브라우저에서 `Ctrl+Shift+R` 만 하면 됨.

### B. server/src/ TypeScript 코드가 바뀐 경우만 수동 재시작 필요

```powershell
# 관리자 PowerShell
cd C:\Users\강민구\mypm\server
npm run build
Stop-ScheduledTask MyPMBackend; Start-ScheduledTask MyPMBackend
```

### C. Webhook이 작동 안 할 때 (수동 폴백)

```powershell
cd C:\Users\강민구\mypm
git pull
```

CF 캐시 수동 퍼지 (`server\.env` 기준):
```powershell
$e = Get-Content "C:\Users\강민구\mypm\server\.env" | ConvertFrom-StringData
Invoke-RestMethod `
  -Uri "https://api.cloudflare.com/client/v4/zones/$($e.CLOUDFLARE_ZONE_ID)/purge_cache" `
  -Method Post `
  -Headers @{ "Authorization" = "Bearer $($e.CLOUDFLARE_API_TOKEN)"; "Content-Type" = "application/json" } `
  -Body '{"purge_everything":true}'
```

### D. 버전 확인

```powershell
(Invoke-WebRequest -Uri "https://mypm.growpension.com/sw.js" -Headers @{"Cache-Control"="no-cache"} -UseBasicParsing).Content | Select-String "mypm-v0"
```

### E. 브라우저 강제 새로고침

```
Ctrl+Shift+R
```

> ⚠️ F12 → Application → "Clear site data" 는 **localStorage(자산 데이터)까지 삭제**되므로 금지.  
> Cache Storage만 개별 삭제하거나, Network 탭 "Disable cache" + Ctrl+Shift+R 사용.

---

## 백엔드 서버 관리

### 서버 기동 방식
- **작업 스케줄러** `MyPMBackend` 태스크로 자동 시작 (NSSM 아님 — AhnLab이 PUP 오탐 차단)
- 실행 명령: `node.exe dist\server.js`, 작업폴더: `C:\Users\강민구\mypm\server`
- SYSTEM 계정, 부팅 시 자동 실행, 크래시 시 1분 후 재시작

### 상태 확인 / 재시작 (관리자 PowerShell)

```powershell
# 상태 확인 — 반드시 이름 직접 지정 (와일드카드 검색에서 안 걸릴 수 있음)
Get-ScheduledTask MyPMBackend,MyPMTunnel | Select TaskName,State

# 재시작
Stop-ScheduledTask MyPMBackend; Start-ScheduledTask MyPMBackend
```

### 태스크가 응답 안 할 때 (프로세스 강제 재시작)

```powershell
# node 프로세스 확인 (SI=0 이면 SYSTEM 권한 → 관리자 PowerShell 필요)
Get-Process node | Select Id, SI

# 강제 종료 후 태스크 재시작
Stop-Process -Id <PID> -Force
Start-Sleep 2
Start-ScheduledTask MyPMBackend
```

---

## 집 밖에서 업데이트하는 방법

Webhook이 자동으로 처리하므로 별도 원격 접속 불필요.  
서버 재시작이 필요한 경우(TypeScript 변경)에만 아래 방법 사용:

### 방법 1. 원격 데스크톱(RDP)

```
mstsc → 집 PC → 관리자 PowerShell → Stop/Start-ScheduledTask MyPMBackend
```

### 방법 2. SSH over Cloudflare Tunnel

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
  - hostname: ssh.growpension.com
    service: ssh://localhost:22
  - service: http_status:404
```

```powershell
cloudflared tunnel route dns mypm ssh.growpension.com
cloudflared service restart
```

이후 어디서든:
```bash
ssh -o "ProxyCommand cloudflared access ssh --hostname ssh.growpension.com" 강민구@ssh.growpension.com
```

---

## 문제 해결

| 증상 | 원인 | 해결 |
|------|------|------|
| push 후 사이트 업데이트 안 됨 | Webhook 미동작 | 서버 로그 확인 → 수동 git pull |
| git pull 했는데도 옛날 버전 | Cloudflare 캐시 | 수동 CF purge (C항 참고) |
| purge 해도 옛날 버전 | 브라우저 SW 캐시 | Ctrl+Shift+R |
| 사이트 자체가 안 열림 | cloudflared 또는 서버 중단 | Get-ScheduledTask 상태 확인 |
| 서버 확인 | — | `https://mypm.growpension.com/api/health` → `{"ok":true}` |
| Webhook 동작 확인 | — | GitHub → Webhooks → Recent Deliveries |
