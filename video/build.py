#!/usr/bin/env python3
"""Builds pitch/index.html (HyperFrames composition) from the voice-over lines, their real durations and word timings."""
import json, os, re, subprocess, html

ROOT = os.path.dirname(os.path.abspath(__file__))
VO = f'{ROOT}/assets/vo'
SHOTS = f'{ROOT}/assets/shots'
for f in sorted(os.listdir(SHOTS)):
    if f.endswith('.png'):
        jpg = f'{SHOTS}/{f[:-4]}.jpg'
        if not os.path.exists(jpg) or os.path.getmtime(jpg) < os.path.getmtime(f'{SHOTS}/{f}'):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{SHOTS}/{f}', '-q:v', '3', jpg], check=True)
MEMORY = os.path.exists(f'{ROOT}/assets/img/memory-1910.jpg')
lines = dict((n, re.sub(r'\[[^\]]*\]\s*', '', t).strip()) for n, t in json.load(open(f'{VO}/lines.json')))
lines['08-close'] = 'Zouave. See your flood… before it comes. À bientôt!'
dur = lambda n: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{VO}/{n}.mp3'], capture_output=True, text=True).stdout)
words = lambda n: json.load(open(f'{VO}/{n}.words.json'))

order = ['01-hook', '02-intro', '03-rise', '04-home'] + (['05-memory'] if MEMORY else []) + ['06-agent', '07-tech', '08-close']
GAP, t = 0.45, 0.8
GCREDIT = 'Google Maps · Photorealistic 3D Tiles · Map data ©Google · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · IBCAO · Landsat / Copernicus'
HOLD = {'04-home': 3.2, '07-tech': 1.6}  # seconds of picture after a voice-over line (the water keeps rising)
segments = []
for n in order:
    d = dur(n)
    segments.append({'name': n, 'vo': t, 'd': d, 'words': words(n)})
    t += d + GAP + HOLD.get(n, 0)
END = round(t + 2.2, 2)

def at(seg, needle, fallback=0.0):
    """Film time of the first spoken word matching `needle` in a segment."""
    for w in seg['words']:
        if re.sub(r'\W', '', w['w'].lower()).startswith(needle.lower()):
            return round(seg['vo'] + w['s'], 2)
    return round(seg['vo'] + fallback, 2)

def subtitles(seg):
    """Script text split into short phrases, timed proportionally on the recognised words."""
    text = lines[seg['name']]
    phrases = [p.strip() for p in re.split(r'(?<=[.!?:,])\s+', text) if p.strip()]
    merged, cur = [], ''
    for p in phrases:
        cur = f'{cur} {p}'.strip()
        if len(cur.split()) >= 4 or p is phrases[-1]: merged.append(cur); cur = ''
    if cur: merged.append(cur)
    total = sum(len(p.split()) for p in merged); ws = seg['words']; out, k = [], 0
    for p in merged:
        a = round(k * len(ws) / total); k += len(p.split()); b = max(a, round(k * len(ws) / total) - 1)
        s = seg['vo'] + ws[min(a, len(ws) - 1)]['s']; e = seg['vo'] + ws[min(b, len(ws) - 1)]['e'] + 0.25
        out.append((round(s, 2), round(max(e - s, 0.8), 2), p))
    for i in range(len(out) - 1):  # no overlaps
        s, d, p = out[i]; out[i] = (s, round(min(d, out[i + 1][0] - s - 0.02), 2), p)
    return out

S = {seg['name']: seg for seg in segments}
scenes, tl = [], []
def scene(sid, start, end, inner, z):
    scenes.append(f'<section id="{sid}" class="clip scene" data-start="{start:.2f}" data-duration="{end - start:.2f}" data-track-index="{z}" style="z-index:{z}">{inner}</section>')
    tl.append(f'tl.fromTo("#{sid}", {{opacity: 0}}, {{opacity: 1, duration: 0.45, ease: "power2.out"}}, {start:.2f});')

def kb(sel, start, d, s0=1.0, s1=1.08, x0=0, x1=0, y0=0, y1=0, origin='50% 50%'):
    tl.append(f'tl.fromTo("{sel}", {{scale: {s0}, xPercent: {x0}, yPercent: {y0}, transformOrigin: "{origin}"}}, {{scale: {s1}, xPercent: {x1}, yPercent: {y1}, duration: {d:.2f}, ease: "none"}}, {start:.2f});')
def pop(sel, start, d=0.6, y=40):
    tl.append(f'tl.fromTo("{sel}", {{opacity: 0, y: {y}, filter: "blur(10px)"}}, {{opacity: 1, y: 0, filter: "blur(0px)", duration: {d}, ease: "power3.out"}}, {start:.2f});')
def out(sel, start, d=0.4):
    tl.append(f'tl.to("{sel}", {{opacity: 0, duration: {d}, ease: "power2.in"}}, {start:.2f});')

seg_end = lambda n: S[n]['vo'] + S[n]['d'] + GAP * 0.7 + HOLD.get(n, 0)

# 1 · Hook
h = S['01-hook']; s0 = 0.0; e0 = seg_end('01-hook')
bg = 'assets/img/memory-1910.jpg' if MEMORY else 'assets/img/g-overview.jpg'
scene('hook', s0, e0, f'''<img class="bg {'sepia' if MEMORY else 'dim'}" src="{bg}" alt="">
<div class="veil"></div>{'' if MEMORY else '<p class="credit on">' + GCREDIT + '</p>'}
<div class="hook-stack">
  <p class="eyebrow" id="h-date">JANUARY 1910 · PARIS</p>
  <p class="big" id="h-level">8.62&nbsp;m</p><p class="small" id="h-level-sub">the Seine at the Austerlitz gauge</p>
  <div class="stats"><div id="h-people"><b>5 million</b><span>people hit, at most</span></div><div id="h-cost"><b>€30 billion</b><span>in damage, at most</span></div></div>
  <p class="question" id="h-q">What would it mean for <em>your street?</em></p>
  <p class="source" id="h-src">If 1910 happened today · OECD estimates</p>
</div>''', 1)
kb('#hook .bg', s0, e0 - s0, 1.12, 1.0)
pop('#h-date', h['vo'] + 0.1); pop('#h-level', at(h, 'eight')); pop('#h-level-sub', at(h, 'eight') + 0.4, 0.5, 20)
pop('#h-people', at(h, 'five')); pop('#h-cost', at(h, 'thirty')); pop('#h-src', at(h, 'five') + 0.6, 0.5, 10)
pop('#h-q', at(h, 'most'), 0.8)

# 2 · Intro (the Zouave talks)
i = S['02-intro']; s1 = e0 - 0.4; e1 = seg_end('02-intro')
scene('intro', s1, e1, '''<img class="bg" src="assets/img/g-alma.jpg" alt="">
<div class="veil soft"></div><p class="credit on">Google Maps · Photorealistic 3D Tiles · Map data ©Google · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · IBCAO · Landsat / Copernicus</p>
<div class="intro-card"><img src="assets/img/zouave.png" alt=""><div><p class="eyebrow">MEET</p><h1>Zouave</h1><p>The stone soldier Parisians read the floods on.<br><b>Now he talks.</b></p><p class="tag">Any address · official data only</p></div></div>''', 2)
kb('#intro .bg', s1, e1 - s1, 1.0, 1.14, 0, -3, 0, 2, '60% 55%')
pop('#intro .intro-card', i['vo'] + 0.2, 0.9)
out('#intro .intro-card', at(i, 'ask') - 0.2)

# 3 · The Seine rises
r = S['03-rise']; s2 = e1 - 0.4; e2 = seg_end('03-rise')
t16, t10 = at(r, '2016', 4.5), at(r, '1910', 8.5)
scene('rise', s2, e2, '''<img class="bg" id="r-today" src="assets/shots/03-today.jpg" alt="">
<img class="bg" id="r-2016" src="assets/shots/04-2016.jpg" alt="">
<img class="bg" id="r-1910" src="assets/shots/05-1910.jpg" alt="">
<img class="bg" id="r-google" src="assets/img/g-overview.jpg" alt=""><p class="credit" id="r-credit">Google Maps · Photorealistic 3D Tiles · Map data ©Google · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · IBCAO · Landsat / Copernicus</p>
<div class="chip" id="c-today">TODAY</div><div class="chip" id="c-2016">JUNE 2016 · quays closed</div><div class="chip warn" id="c-1910">JANUARY 1910 · 7,505 buildings in the flood zone (mapped area)</div>''', 3)
for sel, a, b in [('#r-today', s2, t16), ('#r-2016', t16 - 0.3, t10), ('#r-1910', t10 - 0.3, e2)]:
    tl.append(f'tl.fromTo("{sel}", {{opacity: 0}}, {{opacity: 1, duration: 0.5}}, {a:.2f});')
    kb(sel, a, b - a + 0.6, 1.0, 1.06)
pop('#c-today', s2 + 0.4); out('#c-today', t16 - 0.3); pop('#c-2016', t16); out('#c-2016', t10 - 0.3); pop('#c-1910', t10)
tg = t10 + 2.2
tl.append(f'tl.fromTo("#r-google", {{opacity: 0}}, {{opacity: 1, duration: 0.9, ease: "sine.inOut"}}, {tg:.2f});')
kb('#r-google', tg, e2 - tg + 0.6, 1.0, 1.1, 0, 0, 0, 0, '45% 60%')
pop('#r-credit', tg + 0.3, 0.5, 0)

# 4 · Your home
m = S['04-home']; s3 = e2 - 0.4; e3 = seg_end('04-home')
tstreet = at(m, 'this', 6.0)
scene('home', s3, e3, '''<img class="bg" id="m-card" src="assets/img/g-home.jpg" alt=""><p class="credit on" id="m-gcredit">Google Maps · Photorealistic 3D Tiles · Map data ©Google · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · IBCAO · Landsat / Copernicus</p>
<div class="street" id="m-street"><img class="bg" src="assets/img/street-dry.jpg" alt=""><img class="bg" id="m-05" src="assets/img/street-0.5.jpg" alt=""><img class="bg" id="m-15" src="assets/img/street-1.5.jpg" alt=""></div>
<div class="chip" id="c-home">4 Rue Traversière · 1 to 2 m of water</div><div class="chip warn" id="c-sim">Simulation, not a forecast</div>
<div class="chip right" id="c-d05">Rising… 0.5 m</div><div class="chip right" id="c-d15">1.5 m · Estimated (official class 1–2 m)</div>
<p class="credit" id="m-credit">Flood: OpenAI image edit · Photo: Lejun / Panoramax, CC BY-SA 4.0</p>''', 4)
kb('#m-card', s3, tstreet - s3 + 0.6, 1.0, 1.12, 0, 0, 0, 0, '62% 35%')
t05, t15 = tstreet + 1.6, tstreet + 3.6
tl.append(f'tl.fromTo("#m-street", {{opacity: 0}}, {{opacity: 1, duration: 0.6}}, {tstreet - 0.3:.2f});')
kb('#m-street', tstreet - 0.3, e3 - tstreet + 0.4, 1.0, 1.12, 0, 0, 0, 0, '55% 60%')
tl.append(f'tl.fromTo("#m-05", {{opacity: 0}}, {{opacity: 1, duration: 1.4, ease: "sine.inOut"}}, {t05:.2f});')
tl.append(f'tl.fromTo("#m-15", {{opacity: 0}}, {{opacity: 1, duration: 1.8, ease: "sine.inOut"}}, {t15:.2f});')
pop('#c-home', at(m, 'four', 2.0)); out('#c-home', tstreet - 0.3); pop('#c-sim', at(m, 'simulation', 8.0))
out('#m-gcredit', tstreet - 0.3); pop('#c-d05', t05 + 0.2, 0.5, 20); out('#c-d05', t15); pop('#c-d15', t15 + 0.4, 0.6, 20); pop('#m-credit', tstreet + 0.4, 0.5, 0)
last_end = e3

# 5 · Memory of 1910 (real photograph), when fetched
if MEMORY:
    y = S['05-memory']; s4 = e3 - 0.4; e4 = seg_end('05-memory')
    scene('memory', s4, e4, '''<img class="bg sepia" src="assets/img/memory-1910.jpg" alt=""><div class="veil soft"></div>
<div class="chip warn" id="c-real">REAL PHOTO · Bercy, January 1910</div><p class="credit" id="mem-credit"></p>''', 5)
    kb('#memory .bg', s4, e4 - s4, 1.0, 1.12)
    pop('#c-real', at(y, 'bercy', 3.5))
    last_end = e4

# 6 · The agent shows its work
g = S['06-agent']; s5 = last_end - 0.4; e5 = seg_end('06-agent')
tadv = at(g, 'safety', 8.0)
scene('agent', s5, e5, '''<img class="bg" id="g-trace" src="assets/shots/10-trace.jpg" alt="">
<img class="bg" id="g-advice" src="assets/shots/08-advice.jpg" alt="">
<div class="chip" id="c-tools">Every answer shows its tool calls</div><div class="chip warn" id="c-never">No number without a tool result</div>''', 6)
kb('#g-trace', s5, tadv - s5 + 0.6, 1.0, 1.35, 0, 0, 0, 0, '58% 70%')
tl.append(f'tl.fromTo("#g-advice", {{opacity: 0}}, {{opacity: 1, duration: 0.6}}, {tadv - 0.3:.2f});')
kb('#g-advice', tadv - 0.3, e5 - tadv + 0.4, 1.0, 1.06)
pop('#c-tools', at(g, 'every', 2.0)); out('#c-tools', tadv - 0.3); pop('#c-never', at(g, 'never', 9.5))

# 7 · Under the hood
k = S['07-tech']; s6 = e5 - 0.4; e6 = seg_end('07-tech')
scene('tech', s6, e6, '''<img class="bg" src="assets/shots/11-hood.jpg" alt=""><div class="veil"></div>
<div class="stack">
  <div class="pill" id="k1"><b>OpenAI Realtime</b> voice agent · function calling</div>
  <div class="pill" id="k2"><b>French open data</b> · PPRI flood plan · IGN buildings · Hub’Eau live gauge</div>
  <div class="pill" id="k3"><b>Google Photorealistic 3D + Three.js</b> · the real city under the official water</div>
  <div class="pill" id="k4"><b>ElevenLabs</b> · the Zouave’s French accent</div>
  <div class="pill" id="k5"><b>OpenAI image edits</b> · your street under water, from a real photo</div>
</div>''', 7)
kb('#tech .bg', s6, e6 - s6, 1.04, 1.0)
for sel, word, fb in [('#k1', 'openai', 1.5), ('#k2', 'french', 4.5), ('#k3', 'three', 6.5), ('#k4', 'eleven', 8.5)]: pop(sel, at(k, word, fb), 0.5, 24)
pop('#k5', at(k, 'eleven', 8.5) + 0.7, 0.5, 24)

# 8 · Close
c = S['08-close']; s7 = e6 - 0.4; e7 = END
scene('close', s7, e7, '''<div class="end">
  <img src="assets/img/zouave.png" alt="" id="z-end">
  <h1 id="z-name">Zouave</h1>
  <p class="claim" id="z-claim">See your flood <em>before it comes.</em></p>
  <p class="meta" id="z-meta">Paris DevDay Community Hackathon · Impact → Climate action<br>github.com/nassim-arifette/zouave</p>
</div>''', 8)
pop('#z-end', s7 + 0.2, 0.9, 60); pop('#z-name', c['vo'] + 0.1); pop('#z-claim', at(c, 'see', 1.2), 0.8); pop('#z-meta', at(c, 'bientot', 4.0), 0.8, 10)

# Voice-over and subtitles
audio = '\n'.join(f'<audio id="vo-{seg["name"]}" class="clip" src="assets/vo/{seg["name"]}.mp3" data-start="{seg["vo"]:.2f}" data-duration="{seg["d"]:.2f}" data-track-index="20"></audio>' for seg in segments)
subs = []
for seg in segments:
    if seg['name'] == '08-close': continue
    for j, (s, d, p) in enumerate(subtitles(seg)):
        sid = f'sub-{seg["name"]}-{j}'
        subs.append(f'<p id="{sid}" class="clip sub" data-start="{s:.2f}" data-duration="{d:.2f}" data-track-index="21">{html.escape(p)}</p>')
        tl.append(f'tl.fromTo("#{sid}", {{opacity: 0, y: 10}}, {{opacity: 1, y: 0, duration: 0.18}}, {s:.2f});')

page = f'''<!doctype html>
<html lang="en" data-resolution="landscape">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=1920, height=1080">
<script src="assets/gsap.min.js"></script>
<style>
@font-face {{ font-family: Manrope; src: url(assets/fonts/Manrope-latin.woff2) format("woff2"); font-weight: 200 800; }}
:root {{ --ground:#081219; --ink:#eef4f0; --mint:#a4d6bc; --water:#8fd3e2; --amber:#edce9d; --font-display: Georgia, "Times New Roman", serif; --font-ui: Manrope, Arial, sans-serif; }}
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ width:1920px; height:1080px; overflow:hidden; background:var(--ground); color:var(--ink); font-family:var(--font-ui); }}
#root {{ position:relative; width:1920px; height:1080px; overflow:hidden; background:var(--ground); }}
.scene {{ position:absolute; inset:0; overflow:hidden; background:var(--ground); }}
.bg {{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }}
.bg.dim {{ filter: brightness(.45) saturate(.8); }}
.bg.sepia {{ filter: sepia(.35) contrast(1.08) brightness(.75); }}
.veil {{ position:absolute; inset:0; background: radial-gradient(ellipse 90% 80% at 50% 50%, rgba(8,18,25,.35), rgba(8,18,25,.88)); }}
.veil.soft {{ background: linear-gradient(90deg, rgba(8,18,25,.82) 0%, rgba(8,18,25,.35) 55%, rgba(8,18,25,.1) 100%); }}
.hook-stack {{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; gap:10px; }}
.eyebrow {{ font-size:26px; letter-spacing:8px; color:var(--mint); font-weight:600; }}
.big {{ font-family:var(--font-display); font-size:220px; line-height:1; letter-spacing:-6px; color:var(--water); text-shadow:0 0 60px rgba(143,211,226,.35); }}
.small {{ font-size:28px; color:#b9cac7; margin-bottom:34px; }}
.stats {{ display:flex; gap:120px; margin:10px 0 26px; }}
.stats div {{ display:flex; flex-direction:column; align-items:center; }}
.stats b {{ font-size:96px; font-weight:600; letter-spacing:-3px; color:var(--ink); }}
.stats span {{ font-size:26px; color:#b9cac7; }}
.question {{ font-family:var(--font-display); font-size:64px; }}
.question em {{ color:var(--amber); }}
.source {{ font-size:20px; color:#8fa6aa; letter-spacing:1px; margin-top:6px; }}
.intro-card {{ position:absolute; left:110px; top:50%; transform:translateY(-50%); display:flex; align-items:center; gap:48px; }}
.intro-card img {{ width:420px; height:420px; object-fit:contain; filter: drop-shadow(0 30px 40px rgba(0,0,0,.6)); }}
.intro-card h1 {{ font-family:var(--font-display); font-weight:400; font-size:150px; line-height:1; letter-spacing:-4px; }}
.intro-card p {{ font-size:38px; line-height:1.4; color:#d7e4df; margin-top:16px; }}
.intro-card p b {{ color:var(--amber); font-weight:600; }}
.intro-card .tag {{ display:inline-block; font-size:26px; color:var(--mint); border:2px solid rgba(164,214,188,.5); border-radius:999px; padding:10px 22px; margin-top:26px; }}
.chip {{ position:absolute; left:80px; top:80px; font-size:40px; font-weight:700; letter-spacing:1px; color:#0b1a22; background:var(--mint); border-radius:16px; padding:16px 28px; box-shadow:0 20px 60px rgba(0,0,0,.45); opacity:0; }}
.chip.warn {{ background:var(--amber); }}
.chip.right {{ left:auto; right:80px; }}
.street {{ position:absolute; inset:0; opacity:0; }}
.credit {{ position:absolute; right:40px; bottom:18px; z-index:45; font-size:17px; color:rgba(238,244,240,.88); background:rgba(4,10,15,.62); padding:6px 12px; border-radius:8px; opacity:0; }}
.credit.on {{ opacity:1; }}
.stack {{ position:absolute; left:50%; top:47%; transform:translate(-50%,-50%); display:flex; flex-direction:column; gap:18px; width:1400px; }}
.pill {{ font-size:42px; color:#dfeee6; background:rgba(8,19,27,.82); border:2px solid rgba(164,214,188,.35); border-radius:22px; padding:22px 34px; opacity:0; }}
.pill b {{ color:var(--water); font-weight:700; }}
.end {{ position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; background: radial-gradient(ellipse at 50% 40%, #12303a 0%, #081219 70%); }}
.end img {{ width:330px; height:330px; object-fit:contain; filter: drop-shadow(0 24px 40px rgba(0,0,0,.6)); }}
.end h1 {{ font-family:var(--font-display); font-weight:400; font-size:150px; letter-spacing:-4px; line-height:1; margin-top:8px; }}
.claim {{ font-family:var(--font-display); font-size:70px; margin-top:12px; }}
.claim em {{ color:var(--water); }}
.meta {{ font-size:28px; color:#9fb9b5; margin-top:40px; line-height:1.6; }}
.sub {{ position:absolute; left:50%; bottom:64px; transform:translateX(-50%); max-width:1500px; text-align:center; font-size:40px; line-height:1.35; font-weight:600; color:#fff; background:rgba(4,10,15,.72); border-radius:14px; padding:12px 26px; z-index:50; text-shadow:0 2px 8px rgba(0,0,0,.6); }}
.brand {{ position:absolute; right:56px; top:48px; z-index:40; font-size:24px; letter-spacing:8px; font-weight:700; color:rgba(238,244,240,.75); }}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{END:.2f}" data-width="1920" data-height="1080">
{chr(10).join(scenes)}
<p id="brand" class="clip brand" data-start="{s1:.2f}" data-duration="{s7 - s1:.2f}" data-track-index="30">ZOUAVE</p>
{chr(10).join(subs)}
{audio}
</div>
<script>
window.__timelines = window.__timelines || {{}};
const tl = gsap.timeline({{ paused: true }});
{chr(10).join(tl)}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
'''
open(f'{ROOT}/index.html', 'w').write(page)
print('duration', END, 's; scenes', len(scenes), '; subtitles', len(subs), '; memory photo', MEMORY)
