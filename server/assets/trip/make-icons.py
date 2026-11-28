# 여행앱 홈 화면 아이콘 v2 — 플랫 일러스트 오페라하우스(흰 조개껍데기 돛 + 회색 안쪽 + 연갈색 기단 + 진한 외곽선).
# 배경을 꽉 채운 정사각형(iOS 둥근모서리 / 안드로이드 maskable 안전영역 중앙 80% 안에 건물).
from PIL import Image, ImageDraw
N, S = 1024, 4
BG, SKY = (234, 244, 240), (214, 236, 230)
INK, WHITE, SHADE, INNER = (34, 46, 43), (255, 255, 255), (206, 214, 212), (92, 104, 101)
TAN, TAN_D, GREEN, GREEN_L = (205, 172, 145), (172, 138, 112), (15, 107, 79), (63, 160, 125)
LW = 10  # 외곽선 두께(1024 기준)
img = Image.new('RGB', (N*S, N*S), BG); d = ImageDraw.Draw(img)
P = lambda pts: [(x*S, y*S) for x, y in pts]
def line(pts, w=LW, c=INK): d.line(P(pts), fill=c, width=int(w*S), joint='curve')
def qb(a, c, b, n=48): return [((1-t)**2*a[0]+2*(1-t)*t*c[0]+t*t*b[0], (1-t)**2*a[1]+2*(1-t)*t*c[1]+t*t*b[1]) for t in [i/n for i in range(n+1)]]
def shell(tip, front, back, ctrl, shade_frac=0.0):
    """조개껍데기 돛: 꼭짓점 → 앞 밑점은 곧은 선, 꼭짓점 → 뒤 밑점은 바깥으로 볼록한 곡선(ctrl).
    안쪽 그늘(INNER 삼각형)은 앞·뒤 밑점 사이 아래쪽."""
    curve = qb(tip, ctrl, back)
    poly = [front, tip] + curve[1:]
    d.polygon(P(poly), fill=WHITE)
    if shade_frac:  # 돛 앞쪽 면에 옅은 그늘 줄
        m = [(front[0]+(tip[0]-front[0])*0.0, front[1])]
        sh = [front, tip, (tip[0]+(back[0]-tip[0])*shade_frac*0.25, tip[1]+(front[1]-tip[1])*0.35), (front[0]+(back[0]-front[0])*shade_frac, front[1])]
        d.polygon(P(sh), fill=SHADE)
    line([front, tip] + curve[1:] + [front])
# 하늘 원(부드러운 배경 강조)
d.ellipse([150*S, 150*S, 874*S, 874*S], fill=SKY)
BASE = 650
# ── 돛 안쪽 그늘(유리면) — 돛보다 먼저 ──
for tri in [[(200,BASE),(262,575),(330,BASE)], [(300,BASE),(368,560),(430,BASE)], [(400,BASE),(470,545),(560,BASE)], [(600,BASE),(700,560),(790,BASE)], [(760,BASE),(810,585),(860,BASE)]]:
    d.polygon(P(tri), fill=INNER); line(tri + [tri[0]], w=6)
# ── 돛: 조개껍데기처럼 비스듬히. 왼쪽 무리는 꼭짓점이 왼쪽 위로, 오른쪽 무리는 오른쪽 위로 ──
shell(tip=(178,450), front=(205,BASE), back=(372,BASE-12), ctrl=(352,405), shade_frac=0.45)
shell(tip=(268,385), front=(300,BASE), back=(478,BASE-18), ctrl=(462,345), shade_frac=0.45)
shell(tip=(372,268), front=(405,BASE), back=(650,BASE-26), ctrl=(640,245), shade_frac=0.42)   # 가운데 큰 돛
shell(tip=(905,470), front=(870,BASE), back=(725,BASE-12), ctrl=(745,440), shade_frac=0.4)
shell(tip=(842,395), front=(800,BASE), back=(612,BASE-22), ctrl=(628,365), shade_frac=0.42)
# ── 기단(연갈색) ──
pod = [(170,BASE),(900,BASE),(900,BASE+40),(930,BASE+40),(930,BASE+100),(94,BASE+100),(94,BASE+60),(170,BASE+60)]
d.polygon(P(pod), fill=TAN); line(pod + [pod[0]])
d.polygon(P([(94,BASE+60),(930,BASE+60),(930,BASE+100),(94,BASE+100)]), fill=TAN_D); line([(94,BASE+60),(930,BASE+60)], w=6)
line(pod + [pod[0]])
line([(200,BASE+28),(560,BASE+28)], w=5); line([(600,BASE+28),(870,BASE+28)], w=5)
for x in range(400, 660, 36): d.rectangle([x*S,(BASE+72)*S,(x+20)*S,(BASE+90)*S], fill=INK)  # 계단 창
# ── 물(초록) ──
d.rectangle([0, (BASE+100)*S, N*S, N*S], fill=GREEN)
for i, (y, w) in enumerate([(BASE+140, 520), (BASE+190, 360)]):
    d.rounded_rectangle([(512-w//2)*S, y*S, (512+w//2)*S, (y+18)*S], radius=9*S, fill=GREEN_L)
img = img.resize((N, N), Image.LANCZOS)
for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(f'icon-{size}.png', optimize=True)
pv = Image.new('RGB', (1280, 560), (243,246,246)); m = img.resize((480, 480), Image.LANCZOS)
r = Image.new('L', (480, 480), 0); ImageDraw.Draw(r).rounded_rectangle([0,0,479,479], radius=108, fill=255); pv.paste(m, (40, 40), r)
c = Image.new('L', (480, 480), 0); ImageDraw.Draw(c).ellipse([0,0,479,479], fill=255); pv.paste(m, (600, 40), c)
sm = img.resize((120, 120), Image.LANCZOS); r2 = Image.new('L', (120,120), 0); ImageDraw.Draw(r2).rounded_rectangle([0,0,119,119], radius=27, fill=255); pv.paste(sm, (1120, 220), r2)
pv.save('/tmp/claude-0/-home-user-my-ps/ffc92f78-57b6-52af-bc71-be45a10e2bd6/scratchpad/icon-preview.png'); print('ok')
