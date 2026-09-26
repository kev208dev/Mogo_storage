# 등급컷 자동 수집 검증 기록

2026-09-26 기준. 광고 문구를 원점수 데이터 fixture로 취급하지 않습니다.
검증된 상대평가 숫자, 시험 식별자, 과목 mapping을 확보한 범위만 adapter에 등록합니다.

| 출처 | 공개 위치 | 공개 데이터/로그인 | 접근 정책·상태 | fixture / 자동 활성 |
| --- | --- | --- | --- | --- |
| 메가스터디 | https://m.megastudy.net/Entinfo/total_rankCut/main.asp | 로그인 없이 2026.07.08·06.04 고3 사회탐구 원점수 표 확인 | robots 허용, `automated_verified` (사회탐구만) | 실제 2건 / 켜짐 |
| EBSi | https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVPreparation.ebs?irecord=202609023&targetCd=D300 | 공개 사전준비 HTML은 서비스 안내와 과목 목록. 점수표 숫자는 확인하지 못함 | https://www.ebsi.co.kr/robots.txt의 `Disallow: /*.ajax$` 확인. `.ajax` 요청 금지. `disabled_policy` | 없음 / 꺼짐 |
| 대성마이맥 | https://www.mimacstudy.com/hmockTest/HmockAnalysisExamPointCut.ds?groupNo=344 | 검색에 나타난 공식 도메인 등급컷 URL은 `Exception` 오류 화면. 실제 숫자·course mapping 미확인 | robots 조회 실패, `disabled_unverified` | 없음 / 꺼짐 |
| 공식 | 평가원(KICE) 모의평가·수능, 주관 교육청 학력평가 원문 필요 | EBSi 역대 등급컷 페이지는 표준점수를 주관 교육청·평가원 출처로, 원점수 백분위를 EBSi 자체분석으로 명시. 공식 **원점수** 구분점수 원문 확인 전 자동 생성 금지 | `disabled_unverified` | 없음 / 꺼짐 |

검증되면 실제 공개 HTML의 필요한 최소 조각만 fixture로 저장하고, malformed 입력과
시험/세부과목 mapping 테스트를 만든 뒤 `adapters/index.ts`에 등록합니다.
로그인, CAPTCHA, 비공개 API, robots 제한 우회는 사용하지 않습니다.

감시 운영 정책: 시험 종료 이후 미확정 슬롯은 공식 원점수 컷이 확인될 때까지
5분 간격으로 확인합니다. 48시간 감속이나 30일 강제 종료는 없습니다.
공식값이 수동으로 등록되면 해당 슬롯은 즉시 `finalized`됩니다.

절대평가(현행 영어·한국사, 2022학년도 이후 수능 체제의 제2외국어/한문)는
고정 원점수 규칙을 UI와 계산기에 적용합니다. watch/snapshot/current 행을 만들지 않고
외부 adapter 요청 목록에서도 제외합니다. 2022학년도 이전 제2외국어/한문은 상대평가이며,
제2외국어/한문 학력평가는 해당 시험의 고정점수 체제 근거를 확인하기 전까지
`unknown`으로 두어 폴링하거나 수능 고정표를 적용하지 않습니다.
Mega에서 관찰한 영어·한국사 원점수는 상대평가 자동 수집 검증 근거가 아닙니다.
고3 사회탐구의 실제 **원점수** 숫자와 mapping을 확인했습니다. 다른 영역은 검증 전까지 비활성입니다.

## Mega 공개 응답 검증 (2026-09-26)

- 공개 URL: https://m.megastudy.net/Entinfo/total_rankCut/main.asp
- `https://m.megastudy.net/robots.txt`는 HTTP 200, `User-agent: *`, `Allow: /`이며 `/Entinfo/total_rankCut/` 경로를 금지하지 않습니다.
- 로그인·인증 쿠키 없이 메인 HTML을 GET하고, 그 페이지의 실제 inline script가 사용하는 `/Entinfo/total_rankCut/main_examRankCut_ax.asp`에 공개 파라미터 `examSeq`, `tabNo=2`로 POST하여 HTTP 200의 사회탐구 원점수 표를 받았습니다. 응답의 Set-Cookie는 재사용하지 않았습니다.
- 시험 목록에서 `357`은 2026.07.08 고3 학력평가, `356`은 2026.06.04 고3 모의평가임을 확인했습니다. adapter는 매번 공개 목록에서 정확한 날짜·유형·학년을 대조하고 ID를 읽습니다. 목록에 없으면 건너뜁니다.
- 두 시험의 사회문화 `원점수` 1등급은 각각 45, 48. 숫자 열에는 별도의 `표준점수` 열도 있으므로 원점수 헤더를 검증합니다. `tests/fixtures/grade-cuts/mega-357-social.html`, `mega-356-social.html`은 실제 응답에서 제목과 사회문화 표의 앞 3개 등급만 보존한 최소 조각입니다.
- 활성 범위: 고3의 현행 상대평가 사회탐구 세부과목. 카탈로그에 존재하고 시험 체제에서 예상되는 course code만 처리합니다. 국어·수학의 표준점수, 영어·한국사 절대평가 값은 사용하지 않습니다.
- 대성은 공개 숫자와 허용 범위를 확인하지 못해 `disabled_unverified`, EBS는 금지된 `.ajax` 요청을 사용하지 않으며 일반 HTML의 숫자가 확인되지 않아 `disabled_policy`입니다. 공식 rawScore 자료도 확인되지 않아 `disabled_unverified`입니다.
