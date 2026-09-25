"""CSV 행과 보류 목록마다, 그 URL 을 찾은 검색어·검색 결과 제목·존재 확인(HEAD) 결과를 남긴다.
사용: python3 evidence.py 2025 > evidence.2025.json"""
import csv, glob, json, os, sys
HERE = os.environ.get("WORK") or os.path.dirname(os.path.abspath(__file__))
Y = sys.argv[1]
found = {}
for f in sorted(glob.glob(os.path.join(HERE, "found", "*.json"))):
    for e in json.load(open(f)):
        found.setdefault(e["url"], {"title": e.get("title", ""), "query": e.get("query", "")})
head = json.load(open(os.path.join(HERE, "head.json")))
rows = list(csv.DictReader(open(os.path.join(HERE, f"official-urls.{Y}.csv"))))
held = json.load(open(os.path.join(HERE, f"held.{Y}.json")))
def ev(u):
    h = head.get(u, {})
    return {"url": u, "search_query": found[u]["query"], "search_title": found[u]["title"],
            "head_status": h.get("status"), "head_content_type": h.get("type")}
out = {"year": int(Y), "method": "검색엔진 색인 결과의 url 필드를 그대로 기록 (URL 생성·수정 없음). wdown.ebsi.co.kr(robots.txt 없음)에 HEAD 1회로 존재만 확인.",
       "imported": [dict(ev(r["official_url"]), slot=f"{r['grade']}-{r['month']} {r['subject']}/{r['course_code']} {r['file_type']}") for r in rows],
       "held": [dict(ev(h["url"]), reason=h["reason"]) for h in held]}
print(json.dumps(out, ensure_ascii=False, indent=1))
