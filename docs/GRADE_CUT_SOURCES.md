# 등급컷 자동 수집 검증 기록

2026-09-25 기준. 광고/서비스 소개 문구는 실제 시험별 원점수 데이터 fixture로 취급하지 않습니다.
검증된 공개 숫자, 시험 식별자, 과목 mapping을 확보할 때까지 adapter를 등록하지 않습니다.

| 출처 | 공개 위치 | 공개 데이터/로그인 | 접근 정책·상태 | fixture / 자동 활성 |
| --- | --- | --- | --- | --- |
| 메가스터디 | https://m.megastudy.net/Entinfo/total_rankCut/main.asp | 로그인 없이 시험 목록(연도/시험명)이 공개됨. 실제 숫자 응답·시험 식별·course mapping 미확인 | m.megastudy.net robots 조회 실패, `disabled_unverified` | 없음 / 꺼짐 |
| EBSi | https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVPreparation.ebs?irecord=202609023&targetCd=D300 | 공개 사전준비 HTML은 서비스 안내와 과목 목록. 점수표 숫자는 확인하지 못함 | https://www.ebsi.co.kr/robots.txt의 `Disallow: /*.ajax$` 확인. `.ajax` 요청 금지. `disabled_policy` | 없음 / 꺼짐 |
| 대성마이맥 | https://www.mimacstudy.com/mobile/main/main.ds | 공개 메인 페이지에서 시험별 등급컷 HTML 위치·course mapping 미확인 | robots 및 이용 범위 미확인, `disabled_unverified` | 없음 / 꺼짐 |
| 공식 | 시험 유형별 평가원/교육청 원문 필요 | 특정 시험의 등급 구분점수 원문·mapping 확인 전 자동 수집 금지 | `disabled_unverified` | 없음 / 꺼짐 |

검증되면 실제 공개 HTML의 필요한 최소 조각만 fixture로 저장하고, malformed 입력과
시험/세부과목 mapping 테스트를 만든 뒤 `adapters/index.ts`에 등록합니다.
로그인, CAPTCHA, 비공개 API, robots 제한 우회는 사용하지 않습니다.

감시 운영 정책: 시험 종료 후 48시간은 5분 간격, 이후 30일까지 1시간 간격으로
미확정 슬롯만 확인하고, 계속 공식 원점수 컷을 확인하지 못하면 `failed`로 표시합니다.
이는 무기한 외부 요청을 방지하는 운영 상한이며 실제 출처별 공개 시간의 통계적 주장으로
해석하지 않습니다. 공식값이 수동으로 등록되면 해당 슬롯은 즉시 `finalized`됩니다.
