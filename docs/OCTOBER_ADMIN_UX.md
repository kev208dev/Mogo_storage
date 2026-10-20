# 2026년 10모 관리자 운영

대상일은 2026-10-20. 운영 화면의 일정 확인 여부는 실제 `exam_schedules.verifiedAt`에서 읽는다. 대상일을 입력했다고 일정이 확인되는 것은 아니다.

## 동선

1. `/admin/coverage?year=2026&month=10`에서 고1·고2·고3 빠른 링크 또는 연도·월·학년 필터를 선택한다.
2. 과목별 시험지/해설, 영어 음원/대본 상태를 확인한다. 과목 편성은 DB의 exam_subjects·exam_courses에서 읽고 게시 파일의 세부과목을 보완한다. 편성이 없으면 전체 누락 수를 추정하지 않는다.
3. 시험 카드의 공식 URL 등록/승인 링크로 `/admin/imports`의 같은 필터를 연다.
4. 헤더 전용 CSV를 다운로드하거나 선택 시험으로 빈 행을 작성한다. 빈 행 작성은 현재 입력을 교체한다. 날짜·학년·원문 표기를 반드시 확인한다.
5. CSV 파일을 선택하거나 붙여넣고 **저장 전 검사**를 누른다. 기존 `importOfficialUrls(dryRun=true)`가 행별 결과를 반환하며 DB 쓰기나 원문 URL 요청은 하지 않는다. 검사 후 입력 변경 시 다시 검사해야 한다.
6. **입력**으로 정상 행만 등록한다. 오류 행은 저장되지 않는다. 결과는 기존 notice·최근 기록에 나타난다. 검사는 CSV 내부 충돌·형식만 검사하므로 DB와의 충돌은 검토 목록의 기존 ReviewDetails에서 확인한다.
7. 공식 URL을 브라우저로 직접 확인하고 기존 승인 체크와 **선택 승인 · 게시**를 사용한다. 후보 등록만으로 공개되지 않는다.

## 상태 해석

- 게시됨: exam_files 존재. 후보의 ready 상태만으로 게시됨이라 판정하지 않는다.
- 검토 대기: manual_review 후보 존재. 이미 게시된 파일에 변경 후보가 있으면 함께 표시한다.
- 정책상 수동: 기존 source policy가 artifacts 수집을 차단. 일반 수집 실패와 구분한다.
- 미확보: 파일과 후보 없음. **원문 미공개로 단정하지 않는다.**
- unavailable: 원문 이용 불가로 표시하고 상세 사유를 보존한다.
- 업체 등급컷: isOfficial=true와 providerStatus=official_final이 모두 확인되지 않으면 공식 확정으로 표시하지 않는다. 샘플 등급컷 제외.

연결된 DB를 조회하며 Production을 자동 식별하지 않는다. Coverage는 샘플 시험을 제외한다. Imports는 샘플 교체용 후보도 표시하고 기존 경고를 유지한다. 상태 수는 선택 시험 기준, 최근 입력 기록·학습 매핑 규칙은 전체 기준이다. 검토 목록은 최대 500건이며 필터를 먼저 적용한다. 필터 중에는 전체 시험에 작용하는 기존 일괄 중복 정리 버튼을 숨긴다.

## 후보 조사 (2026-10-21 KST)

공개 검색 색인에서 EBSi 고1/고2/고3 관련 안내를 찾았지만 시험·과목·파일 유형을 확정하고 브라우저로 확인한 직접 파일 URL은 **0건**이다. `data/imports/october-2026.verified.csv`는 헤더만 있으며 승인 대상이 아니다. 안내 링크는 `october-2026.held.json`에 별도 보류했다. 검색 결과의 2025년 10월 PDF에 적힌 '2026학년도 수능 대비'는 2026년 10모 자료로 취급하지 않았다. URL 추정, 미러 등록, 사이트 자동 요청, 로그인·CAPTCHA 우회, Production 쓰기는 하지 않았다.

## Claude 통합 계약

기존 DB/타입으로 구현 가능하여 schema·scheduler·수집 정책 변경은 없다.

- 읽기: exams(id/year/month/grade/examDate/isSample), exam_subjects(subject), exam_courses(courseId), courses(name/subject), exam_files(subject/courseId/type), source_artifacts(sourceId/status/statusReason), grade_cuts(source/isOfficial/providerStatus/isSample), exam_schedules(examId/examDate/status/verifiedAt).
- 관리자 전용 `adminCoverageDetails(db, ids)` 응답: `{exam, schedule?, pending, cuts, slots:[{subject,courseId,name,materials:[{type,status,detail}]}] }[]`.
- `filteredImportsData(db, filter)`는 기존 reviewInsights/loadReviewNotes/loadMappingRules를 재사용한다. filter는 `{year?,month?,grade?}`. 기존 인증 requireAdmin을 페이지·조회·preview action에서 재확인한다.
- 확정적인 원문 미공개 판정에는 별도 `publicationState: 'not_released'|'released'|'unknown'`, `checkedAt`, `evidenceUrl`이 필요하다. 현재는 unknown을 표현한다. 이 확장은 Claude 담당이며 아직 API/컬럼을 만들지 않았다.
- 시험 누락 탐지는 등록된 과목 편성에 의존한다. 실제 10모 exams/exam_courses와 검증 일정 등록, DB 없는 환경에서 건너뛴 통합/E2E 실행, Production 확인·배포는 통합 단계에서 수행한다.
- 기존 computeFeatureCoverage는 기본 최대 10,000시험을 반환한다. 이 범위 안에서 월 필터를 페이지 나누기 전에 적용한다. 대규모 카탈로그를 위한 month/ids 쿼리 인자는 후속 공통 모듈 통합 사항이다.

## 검증 결과

- `npm test`: 557 통과, 75 skip (격리 DB 미제공). 필터·0건 렌더·부분 게시·정책 차단·예상/공식 등급컷·승인 전 후보·중복/슬롯 충돌·잘못된 CSV·인증 실패 시 조회 차단을 검증했다.
- `npm run typecheck`: `next typegen` 후 통과. 이 컨테이너에서는 typegen에 `NODE_OPTIONS=--import=tsx __NEXT_NODE_NATIVE_TS_LOADER_ENABLED=true`가 필요했다.
- `npm run lint`: 오류 없음, 기존 수정 금지 영역의 경고 3개.
- `npm run format:check`: 통과.
- `npm run build`: 환경 제한으로 실패. 기본 실행은 SWC stacker assertion, native TS 로더 재시도는 `uv_resident_set_memory ENOENT`로 빌드 중단.
- `npm run test:e2e`: 서버 시작에서 `uv_interface_addresses` 시스템 오류. 관리자 승인 E2E는 격리 DB가 필요하며 실행되지 않았다. 기존 입력 E2E를 사전 검사 단계에 맞춰 갱신하고 비관리자 접근 차단 E2E를 추가했다.
- UI 확인: 서버 렌더 테스트로 empty state와 고1/고2/고3 필터 링크 및 선택값을 확인했다. 브라우저 시각 검증·스크린샷은 환경 차단으로 미완료다. 통합 환경에서 모바일/키보드 동선과 등록→검토→승인을 확인해야 한다.
