# 등급컷 자동 수집 검증 기록

2026-09-25 기준. 광고/서비스 소개 문구는 실제 시험별 원점수 데이터 fixture로 취급하지 않습니다.
검증된 공개 숫자, 시험 식별자, 과목 mapping을 확보할 때까지 adapter를 등록하지 않습니다.

| 출처 | 공개 위치 | 공개 데이터/로그인 | 접근 정책·상태 | fixture / 자동 활성 |
| --- | --- | --- | --- | --- |
| 메가스터디 | https://m.megastudy.net/Entinfo/total_rankCut/main.asp | 로그인 없이 2026.07.08 고3 학력평가의 숫자 표 확인. 국어·수학은 표준점수, 영어·한국사는 원점수로 표시. 두 번째 시험의 숫자 응답과 탐구 course mapping 미확인 | m.megastudy.net robots 요청이 502, desktop robots는 브라우저에서 차단, `disabled_unverified` | 없음 / 꺼짐 |
| EBSi | https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVPreparation.ebs?irecord=202609023&targetCd=D300 | 공개 사전준비 HTML은 서비스 안내와 과목 목록. 점수표 숫자는 확인하지 못함 | https://www.ebsi.co.kr/robots.txt의 `Disallow: /*.ajax$` 확인. `.ajax` 요청 금지. `disabled_policy` | 없음 / 꺼짐 |
| 대성마이맥 | https://www.mimacstudy.com/hmockTest/HmockAnalysisExamPointCut.ds?groupNo=344 | 검색에 나타난 공식 도메인 등급컷 URL은 `Exception` 오류 화면. 실제 숫자·course mapping 미확인 | robots 조회 실패, `disabled_unverified` | 없음 / 꺼짐 |
| 공식 | 평가원(KICE) 모의평가·수능, 주관 교육청 학력평가 원문 필요 | EBSi 역대 등급컷 페이지는 표준점수를 주관 교육청·평가원 출처로, 원점수 백분위를 EBSi 자체분석으로 명시. 공식 **원점수** 구분점수 원문 확인 전 자동 생성 금지 | `disabled_unverified` | 없음 / 꺼짐 |

검증되면 실제 공개 HTML의 필요한 최소 조각만 fixture로 저장하고, malformed 입력과
시험/세부과목 mapping 테스트를 만든 뒤 `adapters/index.ts`에 등록합니다.
로그인, CAPTCHA, 비공개 API, robots 제한 우회는 사용하지 않습니다.

감시 운영 정책: 시험 종료 이후 미확정 슬롯은 공식 원점수 컷이 확인될 때까지
5분 간격으로 확인합니다. 48시간 감속이나 30일 강제 종료는 없습니다.
공식값이 수동으로 등록되면 해당 슬롯은 즉시 `finalized`됩니다.

## Mega 브라우저 검증 (2026-09-25)

- 로그인하지 않은 기존 Chrome 탭에서 위 공개 URL의 실제 DOM을 읽음. 첫 화면은
  `#examRankCutArea`의 `고3 2026.07.08 학력평가` 표이며, 시험 목록의 실제 선택 요소는
  `#examNmArea li`이다. 선택 요소에 `fncSelExamSeq(357,'1',0)` 및
  `fncSelExamSeq(356,'1',1)`이 노출되어 각각 2026.07.08 학력평가와
  2026.06.04 모의평가를 가리킨다. 이 ID들은 다른 시험으로 일반화하지 않는다.
- 실제 표 헤더: 국어·수학 `표준점수`, `백분위`; 영어·한국사 `원점수`.
  첫 시험 영어 1등급 90, 한국사 1등급 40은 원점수로 표시된다.
  국어 1등급 132는 표준점수이므로 `rawScore`에 넣을 수 없다.
- 공개 페이지 inline script의 `fncSelExamSeq`는
  `/Entinfo/total_rankCut/main_examRankCut_ax.asp`로 `examSeq`, `tabNo`를
  jQuery POST하고 응답을 `#examRankCutArea`에 넣는다. 이는 브라우저가 표시를 위해
  실제 호출하는 경로라는 구조 확인일 뿐, 자동 요청 허용 검증은 아니다.
- UI에서 2026.06.04를 클릭하면 선택 요소만 바뀌고 표 제목은 2026.07.08로 남았다.
  따라서 두 번째 시험 숫자 및 identity 일치를 확인할 수 없었다.
- `https://m.megastudy.net/robots.txt`는 클라우드 브라우저에서 502
  (connection refused), desktop robots는 브라우저 `ERR_BLOCKED_BY_CLIENT`.
  공개 페이지의 robots 허용 여부와 위 POST 경로의 허용 여부를 확정할 수 없다.
  데스크톱 등급컷 페이지도 이 브라우저에서 콘텐츠가 로드되지 않았다.
- 사회/과학 탭의 원점수 표와 과목명·`courses.code` 매핑을 확인하지 못했다.
  두 시험 fixture, parser, live adapter는 만들거나 등록하지 않는다.

대성 URL은 공개 검색 응답에서 오류 페이지이며 브라우저 이동도 시간 초과입니다.
EBSi는 `.ajax`를 요청하지 않았습니다. 가짜 수치 fixture는 생성하지 않았습니다.
