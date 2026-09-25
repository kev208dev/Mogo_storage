# 등급컷 자동 수집 검증 기록

2026-09-25 기준. 광고/서비스 소개 문구는 실제 시험별 원점수 데이터 fixture로 취급하지 않습니다.
검증된 공개 숫자, 시험 식별자, 과목 mapping을 확보할 때까지 adapter를 등록하지 않습니다.

| 출처 | 공개 위치 | 공개 데이터/로그인 | 접근 정책·상태 | fixture / 자동 활성 |
| --- | --- | --- | --- | --- |
| 메가스터디 | https://m.megastudy.net/Entinfo/total_rankCut/main.asp | 로그인 없이 시험 목록(연도/시험명)이 공개됨. 실제 숫자 응답·시험 식별·course mapping 미확인 | m.megastudy.net robots 조회 실패, `disabled_unverified` | 없음 / 꺼짐 |
| EBSi | https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVPreparation.ebs?irecord=202609023&targetCd=D300 | 공개 사전준비 HTML은 서비스 안내와 과목 목록. 점수표 숫자는 확인하지 못함 | https://www.ebsi.co.kr/robots.txt의 `Disallow: /*.ajax$` 확인. `.ajax` 요청 금지. `disabled_policy` | 없음 / 꺼짐 |
| 대성마이맥 | https://www.mimacstudy.com/hmockTest/HmockAnalysisExamPointCut.ds?groupNo=344 | 검색에 나타난 공식 도메인 등급컷 URL은 `Exception` 오류 화면. 실제 숫자·course mapping 미확인 | robots 조회 실패, `disabled_unverified` | 없음 / 꺼짐 |
| 공식 | 평가원(KICE) 모의평가·수능, 주관 교육청 학력평가 원문 필요 | EBSi 역대 등급컷 페이지는 표준점수를 주관 교육청·평가원 출처로, 원점수 백분위를 EBSi 자체분석으로 명시. 공식 **원점수** 구분점수 원문 확인 전 자동 생성 금지 | `disabled_unverified` | 없음 / 꺼짐 |

검증되면 실제 공개 HTML의 필요한 최소 조각만 fixture로 저장하고, malformed 입력과
시험/세부과목 mapping 테스트를 만든 뒤 `adapters/index.ts`에 등록합니다.
로그인, CAPTCHA, 비공개 API, robots 제한 우회는 사용하지 않습니다.

감시 운영 정책: 시험 종료 이후 미확정 슬롯은 공식 원점수 컷이 확인될 때까지
5분 간격으로 확인합니다. 48시간 감속이나 30일 강제 종료는 없습니다.
공식값이 수동으로 등록되면 해당 슬롯은 즉시 `finalized`됩니다.

2026-09-25 재검증: Mega 공개 목록은 검색 색인에서 확인했지만 클라우드 브라우저의
해당 페이지가 빈 화면으로 남고 이동이 시간 초과되어 숫자 DOM과 네트워크 응답을 확인하지
못했습니다. 대성 URL은 공개 검색 응답에서 오류 페이지이며 브라우저 이동도 시간 초과입니다.
EBSi는 `.ajax`를 요청하지 않았습니다. 가짜 수치 fixture는 생성하지 않았습니다.
