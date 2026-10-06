# 공식 source 자동 수집 가능성 조사 (2026-10-06)

조건: 로그인·CAPTCHA·anti-bot(대기열 포함)·robots.txt 를 우회하지 않는다. robots.txt 는 매 조사 시점 기준.
각 사이트에 robots.txt 와 확인용 페이지 1~2회만 요청했다.

| source                                  | robots.txt                      | 확인 결과                                                                                                                                                                                                     | 자동 수집       |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| EBSi `www.ebsi.co.kr`                   | `Disallow: /*.ajax# 공식 source 자동 수집 가능성 조사 (2026-10-06)

조건: 로그인·CAPTCHA·anti-bot(대기열 포함)·robots.txt 를 우회하지 않는다. robots.txt 는 매 조사 시점 기준.
각 사이트에 robots.txt 와 확인용 페이지 1~2회만 요청했다.

| source                                  | robots.txt                      | 확인 결과                                                                                                                                                                                                     | 자동 수집       |
| --------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
            | 2026-10-06 live 재확인: 기출 페이지 HTML의 `boardListArea`는 비어 있고 결과는 `previousPaperListAjax.ajax` 호출에 의존. SafeFetcher도 robots 정책으로 해당 AJAX 요청을 차단함 | ✗ (robots 금지) |
| 평가원 수능 `www.suneung.re.kr`         | `User-agent: * Disallow: /`     | 사이트 전체 금지                                                                                                                                                                                              | ✗               |
| 평가원 `www.kice.re.kr`                 | `User-agent: * Disallow: /`     | 사이트 전체 금지                                                                                                                                                                                              | ✗               |
| 서울 `www.sen.go.kr`                    | 일부 허용, `*.pdf/hwp/zip` 금지 | 첫 화면이 NetFunnel 대기열(트래픽 제어)을 거침 → 자동 통과는 anti-bot 우회. 첨부 파일(pdf·hwp) 요청도 금지                                                                                                    | ✗               |
| 경기 `www.goe.go.kr`                    | `/search` 만 금지               | 첫 화면·메인에 학력평가 자료실 링크 없음                                                                                                                                                                      | 후보 없음       |
| 인천 `www.ice.go.kr`                    | `/upload/` 등 금지              | 메인에 학력평가 자료실 링크 없음, 첨부 경로(`/upload/`) 금지                                                                                                                                                  | 후보 없음       |
| 대구 `www.dge.go.kr`                    | 일부 금지                       | 메인에 학력평가 자료실 링크 없음                                                                                                                                                                              | 후보 없음       |
| 강원 `www.gwe.go.kr`                    | `/nurizip/search/` 만 금지      | 메인에 학력평가 자료실 링크 없음                                                                                                                                                                              | 후보 없음       |
| 충북 `www.cbe.go.kr`                    | `/upload/` 등 금지              | 첨부 경로 금지                                                                                                                                                                                                | 후보 없음       |
| 경북 `www.gbe.kr`                       | 특정 검색엔진만 명시            | 메인 페이지 연결 실패                                                                                                                                                                                         | 확인 불가       |
| 제주 `www.jje.go.kr`                    | `Disallow: /`                   | 전체 금지                                                                                                                                                                                                     | ✗               |
| 부산·광주·대전·울산·세종·충남·전북·전남 | —                               | 이 환경에서 연결이 끊김 (해외 접속 제한으로 보임)                                                                                                                                                             | 확인 불가       |
| 경남 `www.gne.go.kr`                    | robots.txt 없음(404)            | 추가 조사 안 함                                                                                                                                                                                               | 확인 불가       |

결론: **현재 자동 수집 후보로 추가할 수 있는 공식 source 없음.** 기출 자료는 운영자 CSV 입력([사용법](OFFICIAL_URL_IMPORT.md))으로 등록한다.
코드의 `education_office` 기본 설정(서울 게시판 경로)은 합성 fixture 가정이며 실제 자료실이 아님이 확인되어 계속 비활성이다.

다시 조사할 때: 각 기관 robots.txt 확인 → 허용된 경우에만 `npm run ingest:capture` → [ADDING_SOURCE.md](ADDING_SOURCE.md) 절차.
기관의 명시적 이용 허락(제휴)을 받으면 그 범위에 맞춰 source 를 켤 수 있다.

## 코드 반영 (`src/ingestion/sources/policy.ts`)

위 조사 결과는 source × 기능 정책 표로 코드에 고정돼 있습니다. `policy_blocked` 기능은 관리자 화면·CLI·DB 직접 수정 어느 경로로도 실행되지 않습니다.

| source             | 시험 목록 · 파일 목록 · 시험일 감시    | 파일 받기                                                |
| ------------------ | -------------------------------------- | -------------------------------------------------------- |
| `ebsi`             | 금지 (robots.txt `.ajax` 경로)         | 허용 (`wdown.ebsi.co.kr` 는 robots 제한 없음) — 확인용만 |
| `kice`             | 금지 (robots.txt `Disallow: /`)        | 금지                                                     |
| `education_office` | 금지 (NetFunnel 대기열 · pdf/hwp 차단) | 금지                                                     |
| `operator_import`  | 수동 (운영자 CSV + 관리자 승인)        | 서버 요청 없음 (브라우저 확인 후 redirect)               |

정책이 바뀌면(예: 공개 API 제공, robots 변경) 근거를 이 문서에 기록하고 `policy.ts` 의 해당 기능을 `adapter` 로 바꾼 뒤,
[ADDING_SOURCE.md](ADDING_SOURCE.md) 의 fixture 검증 → 승인 → health check 절차를 거쳐야 켜집니다.


### 2026-10-06 EBSi 재검증

GitHub Actions에서 실제 `previousPaperList.ebs?targetCd=D300&year=2026` shell을 캡처했다.
서버 HTML에는 검색 조건과 빈 `boardListArea`가 있고, 결과 목록은 JavaScript가
`previousPaperListAjax.ajax`를 호출해 채운다. 같은 SafeFetcher로 AJAX POST를 시도했을 때
`ROBOTS_DISALLOWED`로 차단되는 것을 확인했다. 따라서 자동 목록 discovery를 우회 구현하지 않고
계속 `policy_blocked`로 유지한다.

반면 `wdown.ebsi.co.kr` 직접 파일은 기존 정책대로 제한된 SafeFetcher 요청이 가능하다.
브라우저에서 승인된 EBSi 직접 파일에 한해 단어/대본 같은 파생 학습자료 처리를 허용하며,
이 예외는 목록 discovery 권한을 의미하지 않는다.
