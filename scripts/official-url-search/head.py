"""검색에서 발견된 wdown.ebsi.co.kr URL 에 HEAD 1회씩 (본문 다운로드 없음, 1.5초 간격).
wdown.ebsi.co.kr 는 robots.txt 가 없다(404). robots 가 막는 호스트(suneung.re.kr 등)에는 요청하지 않는다.
사용: python3 head.py <year>   → head.json 갱신
"""
import glob, json, os, ssl, sys, time, urllib.request

HERE = os.environ.get("WORK") or os.path.dirname(os.path.abspath(__file__))
YEAR = sys.argv[1]
out = os.path.join(HERE, "head.json")
res = json.load(open(out)) if os.path.exists(out) else {}
urls = set()
for f in glob.glob(os.path.join(HERE, "found", "*.json")):
    for e in json.load(open(f)):
        u = e.get("url", "")
        if u.startswith("https://wdown.ebsi.co.kr/W61001/01exam/" + YEAR):
            urls.add(u)
ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt")
for u in sorted(urls):
    if u in res and res[u].get("ok"):
        continue
    for attempt in range(3):
        try:
            req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "mogo-storage-url-check/1.0 (operator import; HEAD only)"})
            with urllib.request.urlopen(req, timeout=20, context=ctx) as r:
                ct = r.headers.get("content-type", "")
                res[u] = {"status": r.status, "type": ct, "length": r.headers.get("content-length"), "final": r.geturl(),
                          "ok": r.status == 200 and ("pdf" in ct or "audio" in ct or "octet-stream" in ct or "mpeg" in ct)
                          and r.geturl().startswith("https://wdown.ebsi.co.kr/")}
            break
        except urllib.error.HTTPError as e:
            res[u] = {"status": e.code, "ok": False}
            break
        except Exception as e:  # 네트워크 오류는 재시도
            res[u] = {"status": f"error:{type(e).__name__}", "ok": False}
            time.sleep(3)
    time.sleep(1.5)
json.dump(res, open(out, "w"), indent=1)
print(sum(1 for u in urls if res.get(u, {}).get("ok")), "/", len(urls), "ok")
