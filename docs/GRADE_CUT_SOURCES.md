# 등급컷 자동 수집 검증 기록

2026-09-25 기준. 광고/서비스 소개 문구는 실제 시험별 원점수 데이터 fixture로 취급하지 않습니다.
검증된 공개 숫자, 시험 식별자, 과목 mapping을 확보할 때까지 adapter를 등록하지 않습니다.

| 출처 | 공개 위치 | 공개 데이터/로그인 | 접근 정책·상태 | fixture / 자동 활성 |
| --- | --- | --- | --- | --- |
| 메가스터디 | https://m.megastudy.net/Entinfo/total_rankCut/main.asp | 역대 등급컷 목록은 공개. 브라우저 실제 페이지 탐색이 시간 초과되어 숫자 응답·시험 식별·course mapping 미확인 | robots 및 이용 범위 미확인, `disabled_unverified` | 없음 / 꺼짐 |
| EBSi | https://www.ebsi.co.kr/ebs/xip/xipa/retrieveSCVPreparation.ebs?irecord=202609023&targetCd=D300 | 공개 사전준비 HTML은 서비스 안내와 과목 목록. 점수표 숫자는 확인하지 못함 | 제공된 robots 규칙 `Disallow: /*.ajax$` 준수, `.ajax` 요청 금지. `disabled_policy` | 없음 / 꺼짐 |
| 대성마이맥 | https://www.mimacstudy.com/mobile/main/main.ds | 공개 메인 페이지에서 시험별 등급컷 HTML 위치·course mapping 미확인 | robots 및 이용 범위 미확인, `disabled_unverified` | 없음 / 꺼짐 |
| 공식 | 시험 유형별 평가원/교육청 원문 필요 | 특정 시험의 등급 구분점수 원문·mapping 확인 전 자동 수집 금지 | `disabled_unverified` | 없음 / 꺼짐 |

검증되면 실제 공개 HTML의 필요한 최소 조각만 fixture로 저장하고, malformed 입력과
시험/세부과목 mapping 테스트를 만든 뒤 `adapters/index.ts`에 등록합니다.
로그인, CAPTCHA, 비공개 API, robots 제한 우회는 사용하지 않습니다.
