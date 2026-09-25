"""CSV 로 채운 슬롯 vs 기대 슬롯 → 누락 목록 (markdown). 사용: python3 gap.py 2025
기대 과목 가정(2015 개정 체제, csat_2022):
  고1: 국어·수학·영어·한국사·통합사회·통합과학
  고2: + 사회탐구 9 · 과학탐구 Ⅰ 4
  고3 학평: + 사회탐구 9 · 과학탐구 8
  고3 모평·수능: + 직업탐구 6 · 제2외국어/한문 9
  자료: 문제 · 정답 및 해설, 영어는 듣기 음원 추가 (듣기 대본은 선택 자료라 누락에서 제외)
"""
import csv, json, os, sys
from collections import defaultdict

HERE = os.environ.get("WORK") or os.path.dirname(os.path.abspath(__file__))
Y = sys.argv[1]
rows = list(csv.DictReader(open(os.path.join(HERE, f"official-urls.{Y}.csv"))))
held = json.load(open(os.path.join(HERE, f"held.{Y}.json")))
SOC = ["life-and-ethics", "ethics-and-thought", "korean-geography", "world-geography", "east-asian-history",
       "world-history", "economics", "politics-and-law", "social-culture"]
SCI1 = ["physics-1", "chemistry-1", "life-science-1", "earth-science-1"]
SCI2 = ["physics-2", "chemistry-2", "life-science-2", "earth-science-2"]
VOC = ["agriculture-basics", "industry-general", "commercial-economics", "fisheries-and-shipping",
       "human-development", "successful-career-life"]
L2 = ["german-1", "french-1", "spanish-1", "chinese-1", "japanese-1", "russian-1", "arabic-1", "vietnamese-1",
      "classical-chinese-1"]
KO = {"korean": "국어", "math": "수학", "english": "영어", "history": "한국사",
      "integrated-social": "통합사회", "integrated-science": "통합과학", "life-and-ethics": "생활과 윤리",
      "ethics-and-thought": "윤리와 사상", "korean-geography": "한국지리", "world-geography": "세계지리",
      "east-asian-history": "동아시아사", "world-history": "세계사", "economics": "경제", "politics-and-law": "정치와 법",
      "social-culture": "사회·문화", "physics-1": "물리학Ⅰ", "chemistry-1": "화학Ⅰ", "life-science-1": "생명과학Ⅰ",
      "earth-science-1": "지구과학Ⅰ", "physics-2": "물리학Ⅱ", "chemistry-2": "화학Ⅱ", "life-science-2": "생명과학Ⅱ",
      "earth-science-2": "지구과학Ⅱ", "agriculture-basics": "농업 기초 기술", "industry-general": "공업 일반",
      "commercial-economics": "상업 경제", "fisheries-and-shipping": "수산·해운 산업 기초", "human-development": "인간 발달",
      "successful-career-life": "성공적인 직업 생활", "german-1": "독일어Ⅰ", "french-1": "프랑스어Ⅰ",
      "spanish-1": "스페인어Ⅰ", "chinese-1": "중국어Ⅰ", "japanese-1": "일본어Ⅰ", "russian-1": "러시아어Ⅰ",
      "arabic-1": "아랍어Ⅰ", "vietnamese-1": "베트남어Ⅰ", "classical-chinese-1": "한문Ⅰ"}
T = {"question": "문제", "solution": "해설", "listening_audio": "듣기음원"}


def expected(g, et):
    base = ["korean", "math", "english", "history"]
    if g == 1:
        return base + ["integrated-social", "integrated-science"]
    if g == 2:
        return base + SOC + SCI1
    if et == "school_mock":
        return base + SOC + SCI1 + SCI2
    return base + SOC + SCI1 + SCI2 + VOC + L2


have = defaultdict(set)
exams = {}
for r in rows:
    k = (int(r["grade"]), int(r["month"]))
    exams[k] = (r["exam_type"], r["exam_date"])
    have[k].add((r["course_code"] or r["subject"], r["file_type"]))

out, tot_exp, tot_have = [], 0, 0
per_type = defaultdict(lambda: [0, 0])
for k in sorted(exams):
    g, m = k
    et, d = exams[k]
    miss = []
    n_exp = 0
    for s in expected(g, et):
        for t in (["question", "solution"] + (["listening_audio"] if s == "english" else [])):
            n_exp += 1
            per_type[t][0] += 1
            if (s, t) in have[k]:
                per_type[t][1] += 1
            else:
                miss.append((s, t))
    n_have = n_exp - len(miss)
    tot_exp += n_exp
    tot_have += n_have
    by_s = defaultdict(list)
    for s, t in miss:
        by_s[s].append(T[t])
    et_ko = {"csat": "수능", "kice_mock": "평가원 모의평가", "school_mock": "학력평가"}[et]
    out.append(f"### 고{g} {m}월 {et_ko} ({d}) — 채움 {n_have}/{n_exp}, 누락 {len(miss)}\n")
    out.append("누락: " + (", ".join(f"{KO[s]}({'·'.join(v)})" for s, v in by_s.items()) or "없음") + "\n")
    hk = [h for h in held if h["g"] == g and h["mo"] == m]
    if hk:
        out.append("보류(운영자 확인 필요, CSV 미포함): " + ", ".join(f"`{h['name']}` — {h['reason']}" for h in hk) + "\n")
head = [f"## {Y}년 — 채움 {tot_have}/{tot_exp} 슬롯, 누락 {tot_exp - tot_have}\n",
        "| 자료 종류 | 채움 | 기대 | 누락 |", "|---|---:|---:|---:|"]
for t, (e, h) in per_type.items():
    head.append(f"| {T[t]} | {h} | {e} | {e - h} |")
head.append("")
open(os.path.join(HERE, f"gap.{Y}.md"), "w").write("\n".join(head + out))
print("\n".join(head))
