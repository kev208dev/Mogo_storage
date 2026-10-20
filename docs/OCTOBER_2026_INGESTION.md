# 2026-10-20 전국연합학력평가 — 수집 백엔드 · 운영 런북

작성: 2026-10-21 · 대상: 고1 · 고2 · 고3 (`school_mock`, 2026-10-20) · 관리자 화면 사용법은 [OCTOBER_ADMIN_UX.md](OCTOBER_ADMIN_UX.md)(Astra 작업)를 봅니다.

이 문서는 백엔드(수집 · scheduler · 등급컷 · 운영) 쪽 사실과 절차만 다룹니다. 확인하지 않은 것은 "미확인"으로 적습니다.

## 1. 시험 일정 근거

| 항목         | 값                                                      | 근거                                                                                                    |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 시행일       | 2026-10-20 (고1·고2·고3 같은 날)                        | `data/schedules/2026-10.json` 의 공식 공지 URL(`bsss.pen.go.kr`), 입시 매체 일정표(2026 학평·모평 일정) |
| 고3 주관     | 서울특별시교육청                                        | 언론 보도(당일 EBSi 정답·해설 서비스 개시)                                                              |
| 고1·고2 주관 | 미확인                                                  | —                                                                                                       |
| 출제 영역    | 미확인 (공식 문제지로 확인 전까지 슬롯을 추정하지 않음) | —                                                                                                       |

- 일정은 `Exam schedules` workflow(기본 dry-run)로 운영 DB 에 반영합니다. staging 에는 등록돼 있고, Production DB 반영 여부는 이 작업 환경에서 직접 확인하지 못했습니다.

## 2. 자동 수집이 할 수 있는 것 / 없는 것

| 자료                                         | 자동        | 이유 · 경로                                                                                                |
| -------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| 문제 · 정답 및 해설 PDF                      | ✗           | EBSi 목록은 `.ajax`(robots 금지), KICE 전체 금지, 교육청 NetFunnel·pdf 금지 → **운영자 CSV + 관리자 승인** |
| 영어 듣기 음원 · 대본                        | ✗           | 같은 이유. 승인된 EBSi `wdown` 영어 해설/대본만 파생 학습자료 처리 가능                                    |
| 등급컷 (고1·고2 국어·수학·통합사회·통합과학) | ✓           | 종로학원 · 메가스터디 adapter, pg_cron 5분 (`is_official=false`, 제공기관 추정/확정)                       |
| 등급컷 (고3 국어·수학 선택과목 · 탐구)       | ✓ (수정 후) | 종로학원 `supports()` 결함으로 지금까지 수집 대상에서 빠져 있었음 → PR #44                                 |
| 등급컷 공식값                                | ✗           | 공식 등급컷 자동 adapter 없음. 관리자가 공식 도메인 URL 과 함께 입력할 때만 `is_official=true`             |
| 영어 · 한국사 등급컷                         | 해당 없음   | 학력평가 절대평가                                                                                          |

정기 수집(`INGESTION_ENABLED`)을 켜도 위 표는 바뀌지 않습니다 ([OPERATIONS.md](OPERATIONS.md) "정기 수집 스위치").

## 3. 문제 · 해설 등록 절차 (운영자)

검색 색인에 10월 `wdown` URL 이 아직 없어 후보 자동 생성(`import:candidates`)으로는 만들 수 없습니다(2026-10-21 확인).

1. 브라우저로 EBSi 기출 페이지를 열어 2026년 10월 고1/고2/고3 을 찾습니다. 각 파일을 **직접 열어** 1쪽 머리말(학년도 · 10월 · 학년 · 영역 · 과목 · 문제/해설)을 확인합니다.
2. 확인한 파일의 주소만 CSV 에 적습니다 (`data/imports/official-urls.template.csv` 형식).
   - `year=2026`, `month=10`, `exam_type=school_mock`, `exam_date=2026-10-20`, `grade` 는 문제지 표기 기준.
   - EBSi 경로 `/01exam/YYYYMMDD/goN/` 의 `N` 과 `grade` 가 다르면 다시 확인합니다 (과거 CSV 에 1건 불일치가 있어 검토 필요: 2021 고1 3월 국어 문제 행).
   - 추측 URL · 비공식 미러는 넣지 않습니다. 과목명이 확실하지 않은 변형(`korA` 등)은 넣지 않습니다.
3. 검사만: `npm run import:official-urls -- --file=<csv> --admin=<email> --dry-run` (또는 `/admin/imports` 미리보기)
4. 입력 → 모든 행은 `manual_review` 로 저장되고 **아직 공개되지 않습니다**.
5. `/admin/imports?year=2026&month=10` 에서 파일을 다시 열어 확인하고 "브라우저 확인" 체크 후 승인 → `exam_files(delivery_type=redirect)` 게시.
6. 확인: `npm run ingest:coverage -- --year=2026 --grade=3`, 시험 페이지 다운로드가 302 로 공식 URL 을 가리키는지, `Production smoke`.

**같이 처리할 것:** `data/imports/coverage/2026-expected-slots.csv` 의 2026년 3~9월 공식 PDF 364건은 브라우저 검증까지 끝났지만
`not_imported` 상태로 남아 있습니다 ([2026-progress.md](../data/imports/coverage/2026-progress.md)). 같은 3~5단계로 입력·승인해야 사이트에 보입니다.

## 4. 등급컷 확인 절차

1. PR #44 배포 후 pg_cron(`mogo-grade-cuts`, 시험 종료 후 7일 활성 구간)이 고3 선택과목 · 탐구 slot 도 종로학원에서 확인합니다. 활성 구간은 2026-10-27 17:00 KST 까지입니다.
2. DB 를 쓰지 않는 실제 provider 검증:
   GitHub `Grade cuts (backfill)` → mode `dry-run`, live `true`, year `2026`, month `10`, `exam_date=2026-10-20`, source `jongro`/`megastudy`.
   유효 행이 0건이면 실패로 끝납니다(미공개 · 구조 변경 · slot 불일치를 성공으로 숨기지 않음).
3. 저장값은 `grade_cuts.source` 별로 따로 있고, `is_official=false` · `provider_status`(estimate/final)로 표시됩니다. 같은 값이 반복 관측되면 snapshot 을 만들지 않습니다.

## 5. 승인이 필요한 운영 작업 (이 문서 작성 시점에 실행하지 않음)

| 작업                                                                    | 영향                                              | 전제                            |
| ----------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| PR #44 main 병합 → Production 배포                                      | 등급컷 고3 수집 시작, queue · heartbeat 동작 변경 | CI 통과, Astra PR #43 통합 회귀 |
| `Exam schedules` workflow (`data/schedules/2026-10.json`, dry-run 해제) | 운영 DB 일정 쓰기                                 | dry-run 결과 확인               |
| 10월 공식 URL CSV 입력 · 승인                                           | 운영 DB 쓰기, 자료 공개                           | 운영자 브라우저 확인            |
| 2026년 3~9월 검증 완료 364건 입력 · 승인                                | 운영 DB 쓰기, 자료 공개                           | 운영자 브라우저 재확인          |
| `INGESTION_ENABLED` 변경                                                | 현재 꺼짐이 정상 — 바꿀 필요 없음                 | —                               |
