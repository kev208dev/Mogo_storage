"""검색엔진 결과(found/*.json)에서 실제로 발견된 EBSi URL 만 CSV 슬롯으로 분류한다.

- URL 을 만들거나 고치지 않는다. 발견된 URL 을 그대로 쓴다.
- 연/월/일/학년은 공식 URL 경로(/01exam/YYYYMMDD/goN/)에서, 자료 종류는 파일명 토큰(_mun_/_hsj_/_scr/mp3)에서.
- 선택과목 코드(s_*, g_*, J_*, 2nd_*, 공통 his 등)는 같은 코드의 검색 결과 제목이 과목명을 명시할 때만 매핑한다.
- korA/korB/mathA/mathB 처럼 의미가 확인되지 않는 변형은 import 하지 않고 held 로 남긴다.
- 한 슬롯에 서로 다른 파일 ID 가 둘 이상이면 import 하지 않고 held(conflict) 로 남긴다.
사용: python3 build.py 2025 [head.json]
"""
import csv, glob, json, os, re, sys
from collections import defaultdict

HERE = os.environ.get("WORK") or os.path.dirname(os.path.abspath(__file__))
YEAR = int(sys.argv[1])
HEAD = json.load(open(sys.argv[2])) if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else {}

PATH_RE = re.compile(r"^https://wdown\.ebsi\.co\.kr/W61001/01exam/(\d{4})(\d{2})(\d{2})/go([123])/([A-Za-z0-9_]+)\.(pdf|mp3)$")

COURSES = {  # code: 제목에서 찾을 이름들 (공백·가운뎃점 제거, Ⅰ→1)
    "life-and-ethics": ["생활과윤리"], "ethics-and-thought": ["윤리와사상"],
    "korean-geography": ["한국지리"], "world-geography": ["세계지리"],
    "east-asian-history": ["동아시아사"], "world-history": ["세계사"],
    "economics": ["경제"], "politics-and-law": ["정치와법"], "social-culture": ["사회문화"],
    "physics-1": ["물리학1"], "chemistry-1": ["화학1"], "life-science-1": ["생명과학1"], "earth-science-1": ["지구과학1"],
    "physics-2": ["물리학2"], "chemistry-2": ["화학2"], "life-science-2": ["생명과학2"], "earth-science-2": ["지구과학2"],
    "agriculture-basics": ["농업기초기술"], "industry-general": ["공업일반"], "commercial-economics": ["상업경제"],
    "fisheries-and-shipping": ["수산해운산업기초"], "human-development": ["인간발달"],
    "successful-career-life": ["성공적인직업생활"],
    "german-1": ["독일어1"], "french-1": ["프랑스어1"], "spanish-1": ["스페인어1"], "chinese-1": ["중국어1"],
    "japanese-1": ["일본어1"], "russian-1": ["러시아어1"], "arabic-1": ["아랍어1"], "vietnamese-1": ["베트남어1"],
    "classical-chinese-1": ["한문1"],
    "integrated-social": ["통합사회"], "integrated-science": ["통합과학"],
}
SUBJECT_OF = {c: s for s, cs in {
    "social": ["life-and-ethics", "ethics-and-thought", "korean-geography", "world-geography", "east-asian-history",
               "world-history", "economics", "politics-and-law", "social-culture", "integrated-social"],
    "science": ["physics-1", "chemistry-1", "life-science-1", "earth-science-1", "physics-2", "chemistry-2",
                "life-science-2", "earth-science-2", "integrated-science"],
    "vocational": ["agriculture-basics", "industry-general", "commercial-economics", "fisheries-and-shipping",
                   "human-development", "successful-career-life"],
    "second_language": ["german-1", "french-1", "spanish-1", "chinese-1", "japanese-1", "russian-1", "arabic-1",
                        "vietnamese-1", "classical-chinese-1"],
}.items() for c in cs}
WHOLE = {"kor": "korean", "math": "math", "eng": "english"}
NAME_KO = {"korean": "국어", "math": "수학", "english": "영어", "history": "한국사", "social": "사회탐구",
           "science": "과학탐구", "vocational": "직업탐구", "second_language": "제2외국어/한문"}
TYPE_KO = {"question": "문제", "solution": "정답 및 해설", "listening_audio": "영어 듣기 음원", "listening_script": "영어 듣기 대본"}


def norm(t):
    t = t.replace("Ⅰ", "1").replace("Ⅱ", "2")
    return re.sub(r"[\sㆍ·•.,\-･․∙‧]", "", t)


def parse(url):
    m = PATH_RE.match(url)
    if not m:
        return None
    y, mo, d, g, name, ext = m.groups()
    toks = name.split("_")
    kind = None
    if ext == "mp3":
        kind = "listening_audio"
    elif name.startswith("live_main_paper_"):
        kind = "question" if toks[3] == "1" else "paper_even"
        code, fid = toks[4], toks[5] if len(toks) > 5 else ""
        return dict(y=int(y), mo=int(mo), d=f"{y}-{mo}-{d}", g=int(g), name=name, ext=ext, kind=kind, code=code, fid=fid, part="")
    elif name.startswith("live_main_answer_"):
        return dict(y=int(y), mo=int(mo), d=f"{y}-{mo}-{d}", g=int(g), name=name, ext=ext, kind="answer_key", code=toks[4], fid="", part="")
    for marker, k in (("hsj", "solution"), ("mun", "question"), ("scr", "listening_script")):
        if marker in toks:
            kind = kind or k
            i = toks.index(marker)
            head, tail = toks[:i], toks[i + 1:]
            break
    else:
        return dict(y=int(y), mo=int(mo), d=f"{y}-{mo}-{d}", g=int(g), name=name, ext=ext, kind="unknown", code=name, fid="", part="")
    # head: kor_main / korB_1 / s_samun / g_phy1 / 2nd_ar / eng_1 / J_nupgi
    while len(head) > 1 and head[-1] in ("main", "1", "2", "A", "B"):
        head = head[:-1]
    code = "_".join(head)
    fid = tail[0] if tail else ""
    part = tail[1] if len(tail) > 1 else ""
    return dict(y=int(y), mo=int(mo), d=f"{y}-{mo}-{d}", g=int(g), name=name, ext=ext, kind=kind, code=code, fid=fid, part=part)


items = {}
all_titles = defaultdict(set)  # url -> 검색 결과에서 본 모든 제목
for f in sorted(glob.glob(os.path.join(HERE, "found", "*.json"))):
    for e in json.load(open(f)):
        u = e.get("url", "").strip()
        if u:
            all_titles[u].add(e.get("title", ""))
        if u and u not in items:
            items[u] = {"title": e.get("title", ""), "query": e.get("query", ""), "file": os.path.basename(f)}

GENERIC = {"sat", "gat"}  # 사회탐구/과학탐구 일반 코드: 고1=통합, 고2·3=파일마다 다른 선택과목


def ckey(p):
    return f"{p['code']}@go{p['g']}" if p["code"] in GENERIC else p["code"]


def title_course(title):
    t = norm(title)
    hits = [c for c, names in COURSES.items() if any(n in t for n in names)]
    if "commercial-economics" in hits and "economics" in hits:
        hits.remove("economics")
    return hits[0] if len(hits) == 1 else None


# 1) 코드 → course (제목이 과목명을 정확히 하나 명시할 때만)
votes = defaultdict(lambda: defaultdict(int))
for u, e in items.items():
    p = parse(u)
    if not p:
        continue
    t = norm(e["title"])
    hits = [c for c, names in COURSES.items() if any(n in t for n in names)]
    # 경제 ⊂ 상업경제, 세계사 ⊂ 동아시아사X 등 포함관계 정리
    if "commercial-economics" in hits and "economics" in hits:
        hits.remove("economics")
    if len(hits) == 1:
        votes[ckey(p)][hits[0]] += 1
    if "한국사" in e["title"] and not hits and p["code"] not in WHOLE:
        votes[ckey(p)]["__history"] += 1
code_map = {}
for code, v in votes.items():
    if len(v) == 1:
        code_map[code] = next(iter(v))

# 경로 날짜가 실제 시행 월인지: 같은 날짜 경로의 검색 결과 제목 중 하나라도 그 월(N월)이나 수능을 명시해야 인정한다.
# (예: 20230430 은 일요일이며 어떤 제목도 4월을 말하지 않는다 → 시행일이 아니라 게시 날짜일 수 있음)
date_titles = defaultdict(list)
for u, e in items.items():
    p = parse(u)
    if p:
        date_titles[p["d"]].extend(all_titles[u])
confirmed_dates = set()
for d, ts in date_titles.items():
    mo = int(d[5:7])
    for t in ts:
        if any(int(x) == mo for x in re.findall(r"(\d{1,2})\s*월", t)) or (
            mo == 11 and "대학수학능력시험" in t and "모의평가" not in t
        ):
            confirmed_dates.add(d)
            break

rows, held = [], []


def exam_type(g, mo):
    if g == 3 and mo == 11:
        return "csat"
    if g == 3 and mo in (6, 9):
        return "kice_mock"
    return "school_mock"


slots = defaultdict(list)
for u, e in items.items():
    p = parse(u)
    if not p:
        continue
    if p["y"] != YEAR:
        continue
    reason = None
    subject = course = None
    if p["d"] not in confirmed_dates:
        reason = f"시험 월 미확인 — 경로 날짜 {p['d']} 를 명시한 제목이 없음 (게시일일 수 있음)"
    elif p["kind"] in ("paper_even", "answer_key", "unknown"):
        reason = {"paper_even": "짝수형 문제지(홀수형만 게시)", "answer_key": "정답표(정답 및 해설 우선)", "unknown": "파일명에서 자료 종류 판별 불가"}[p["kind"]]
    elif p["code"] in WHOLE:
        subject = WHOLE[p["code"]]
    elif re.fullmatch(r"(kor|math)[A-C]", p["code"]):
        reason = f"'{p['code']}' 변형(선택과목 구분 미확인)"
    elif p["code"] in GENERIC and p["g"] != 1 and title_course(e["title"]):
        m = title_course(e["title"])
        course, subject = m, SUBJECT_OF[m]
    elif ckey(p) in code_map and (p["code"] not in GENERIC or p["g"] == 1):
        m = code_map[ckey(p)]
        if m == "__history":
            subject = "history"
        else:
            course, subject = m, SUBJECT_OF[m]
    else:
        reason = f"과목 코드 '{p['code']}' 가 제목으로 확인되지 않음"
    if not reason and p["kind"] in ("listening_audio", "listening_script") and subject != "english":
        reason = "영어 외 듣기 자료"
    if not reason and p["mo"] == 11 and p["g"] != 3:
        pass
    if not reason:
        if course in ("integrated-social", "integrated-science") and p["g"] != 1:
            reason = "통합사회/통합과학은 고1 전용"
    if not reason and p["kind"] != "solution" and re.search(r"정답\s*(및|과)\s*해설", e["title"]):
        reason = "제목은 정답 및 해설인데 파일명은 다른 종류 — 확인 필요"
    h = HEAD.get(u)
    if not reason and h is not None and not h.get("ok"):
        reason = f"HEAD 확인 실패 ({h.get('status')})"
    rec = dict(url=u, title=e["title"], query=e["query"], **p, subject=subject, course=course)
    if reason:
        held.append(dict(rec, reason=reason))
    else:
        slots[(p["y"], p["g"], p["mo"], subject, course or "", p["kind"])].append(rec)

for key, recs in slots.items():
    fids = {r["fid"] for r in recs}
    if len(fids) > 1:
        for r in recs:
            held.append(dict(r, reason=f"같은 슬롯에 서로 다른 파일 {len(fids)}개 — 운영자 선택 필요"))
        continue
    recs.sort(key=lambda r: (r["part"] != "", r["part"]))
    r = recs[0]
    y, g, mo, subject, course, kind = key
    et = exam_type(g, mo)
    what = COURSES[course][0] if course else NAME_KO[subject]
    label = f"EBSi {y}년 {mo}월 고{g} {'수능' if et == 'csat' else '모의평가' if et == 'kice_mock' else '학력평가'} {what} {TYPE_KO[kind]}"
    if len(recs) > 1:
        label += f" (같은 파일 ID {len(recs)}개 중 {r['name']})"
    rows.append({
        "year": y, "grade": g, "month": mo, "exam_type": et, "exam_date": r["d"],
        "organizer": "한국교육과정평가원" if et != "school_mock" else "",
        "subject": subject, "course_code": course, "file_type": kind, "official_url": r["url"],
        "original_file_name": f"{r['name']}.{r['ext']}", "source_label": label,
    })
    for other in recs[1:]:
        held.append(dict(other, reason=f"같은 파일 ID 의 다른 번호 — {r['name']} 채택"))

rows.sort(key=lambda r: (r["grade"], r["month"], r["subject"], r["course_code"], r["file_type"]))
cols = ["year", "grade", "month", "exam_type", "exam_date", "organizer", "subject", "course_code", "file_type",
        "official_url", "original_file_name", "source_label"]
out = os.path.join(HERE, f"official-urls.{YEAR}.csv")
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)
json.dump(held, open(os.path.join(HERE, f"held.{YEAR}.json"), "w"), ensure_ascii=False, indent=1)
json.dump({"code_map": code_map, "votes": {k: dict(v) for k, v in votes.items()}},
          open(os.path.join(HERE, "code_map.json"), "w"), ensure_ascii=False, indent=1)
print(f"found={len(items)} year_rows={len(rows)} held={len(held)} -> {out}")
