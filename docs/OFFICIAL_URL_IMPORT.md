# 공식 파일 URL 입력 (운영자 CSV) 사용법

EBSi · 평가원(KICE) · 교육청 사이트는 robots.txt 로 자동 수집을 막고 있습니다 ([조사 기록](SOURCE_SURVEY.md)).
그래서 기출 자료는 **운영자가 브라우저에서 직접 확인한 공식 파일 URL** 을 CSV 로 입력하고, 관리자가 확인 후 승인하는
방식으로 등록합니다. 승인 전에는 서버가 입력 URL 에 **요청하지 않습니다**.

예외는 EBSi 직접 파일 호스트 `wdown.ebsi.co.kr` 입니다. 브라우저 승인까지 끝난 영어 해설/대본 파일에 한해,
robots 제한이 없는 직접 파일 URL을 전용 SafeFetcher allowlist로 다시 받아 단어 후보·문항별 대본 같은
**파생 학습자료 처리**를 할 수 있습니다. 목록/검색 `.ajax` 요청은 계속 금지이며, KICE·교육청·그 밖의
`operator_import` URL은 승인 후에도 서버가 요청하지 않습니다.

## 1. URL 모으기 (사람이 브라우저로)

1. 공식 사이트를 브라우저로 열어 시험·과목을 찾습니다 (로그인·CAPTCHA 가 필요한 자료는 대상 아님).
2. 시험지/정답·해설/듣기 파일을 **직접 열어** 올바른 파일인지 확인합니다.
3. 파일의 주소(브라우저 주소창 또는 다운로드 링크 복사)를 CSV 에 적습니다.
   - 추측으로 만든 URL, 비공식 미러, 블로그, 클라우드 공유 링크는 넣지 않습니다 (공식 도메인 검사에서 거부).
   - 다운로드 버튼이 JavaScript 로만 동작해 파일 URL 을 얻을 수 없으면 그 자료는 입력하지 않습니다.

## 2. CSV 형식

템플릿: [`data/imports/official-urls.template.csv`](../data/imports/official-urls.template.csv) (헤더만 있음). UTF-8.

| 열                   | 필수 | 값                                                                                                                    |
| -------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `year`               | ✓    | **시행 연도** (2026학년도 수능 → 2025)                                                                                |
| `grade`              | ✓    | 1 · 2 · 3                                                                                                             |
| `month`              | ✓    | 1~12                                                                                                                  |
| `exam_type`          | ✓    | `school_mock`(학력평가) · `kice_mock`(평가원 6·9월, 고3) · `csat`(수능, 고3 11월)                                     |
| `exam_date`          |      | `YYYY-MM-DD` (연도는 `year` 와 같아야 함)                                                                             |
| `organizer`          |      | 출제 기관 표기 (예: 서울특별시교육청)                                                                                 |
| `subject`            | ✓    | `korean` `math` `english` `history`(한국사) `social` `science` `vocational` `second-language`(또는 `second_language`) |
| `course_code`        |      | 세부과목 code (`social-culture`, `physics-1`, `japanese-1` …, `src/lib/courses.ts`). 영역 전체 파일이면 비움          |
| `file_type`          | ✓    | `question` · `solution` · `listening_audio` · `listening_script` (듣기는 english 만)                                  |
| `official_url`       | ✓    | https, 공식 기관 도메인만 (ebsi.co.kr · ebs.co.kr · suneung.re.kr · kice.re.kr · 17개 시·도교육청). zip 불가          |
| `original_file_name` |      | 다운로드 파일명 (비우면 URL 의 파일명)                                                                                |
| `source_label`       | ✓    | 공식 사이트에 적힌 원문 표기 (예: `사회탐구 사회·문화 문제`). 그대로 보존됩니다                                       |

예시 (형식 설명용 — 아래 URL 은 실제 파일이 아닙니다):

```csv
year,grade,month,exam_type,exam_date,organizer,subject,course_code,file_type,official_url,original_file_name,source_label
2025,3,9,kice_mock,2025-09-03,한국교육과정평가원,social,social-culture,question,https://www.suneung.re.kr/<실제 파일 경로>,,사회탐구 사회·문화 문제
```

## 3. 입력

- 관리자 화면: `/admin/imports` → CSV 파일 선택 또는 붙여넣기 → [입력]. 먼저 "검사만"으로 오류를 확인할 수 있습니다.
- CLI: `npm run import:official-urls -- --file=data/imports/2025.csv --admin=ops@example.com [--dry-run]`

결과: 행마다 `신규 / 변경 / 동일 / 오류`. 모든 입력 기록(누가, 언제, 행별 오류)은 `official_url_imports` 에 남습니다.

- **idempotent:** 같은 파일을 다시 넣어도 중복이 생기지 않습니다 (시험·영역·세부과목·자료 종류 슬롯 기준).
- 같은 슬롯에 URL 이 바뀌면 "변경"이 되고 다시 **검토 대기**로 돌아갑니다 (새 URL 승인 전까지 기존 게시는 유지).
- 한 CSV 안에서 같은 슬롯에 서로 다른 URL 이 있으면 뒤의 행은 오류입니다.

## 4. 검토 · 승인

`/admin/imports` 의 **검토 대기** 목록에서:

1. 각 행의 [공식 URL 열기]로 파일을 열어 시험·과목·자료 종류가 맞는지 확인합니다.
2. 확인한 행을 선택하고 "브라우저에서 직접 열어 … 확인했습니다" 에 체크합니다 (체크 없으면 승인 불가).
3. [선택 승인 · 게시] → `exam_files.delivery_type = redirect` 로 게시되고 시험 페이지가 즉시 갱신됩니다.
   다운로드 버튼은 `/api/files/{id}/download` → 공식 URL 로 302 redirect 합니다 (공식 원본 파일 자체는 우리 서버·R2 에 복제하지 않음).
   EBSi `wdown.ebsi.co.kr` 의 승인된 영어 해설/대본은 이후 파생 학습자료 처리를 위해 SafeFetcher가 읽을 수 있으며,
   생성 학습지는 별도 검토·승인 전에는 공개되지 않습니다.
4. 틀린 자료는 [선택 거절] (사유 입력). 공개되지 않습니다.

### 샘플 데이터와 섞이지 않음

개발용 샘플 시험과 같은 시험(연도·학년·월)에 실제 자료가 **승인되는 순간**, 그 시험의 샘플 내용(샘플 파일·문항·통계·등급컷·단어·듣기·샘플 일정)을 지우고
실제 시험(`is_sample=false`)으로 전환합니다. 승인 전에는 샘플 페이지가 그대로이고, 입력된 URL 은 공개되지 않습니다.
운영 DB 에는 `npm run db:seed`(샘플)를 실행하지 않는 것을 권장합니다.

### 보류 사유 · 근거 · 충돌 · 짝 추천

검토 대기 행마다 다음이 함께 보입니다 (`artifact_review_notes`, 상태는 바꾸지 않음).

- **보류 사유** (`no_exam_identity` · `grade_ambiguous` · `course_ambiguous` · `slot_conflict` · `url_check_failed` · `duplicate_file` …) 와 근거 목록
  (검색 결과 제목, URL 확인 결과, 브라우저 확인, 1쪽 머리말, 문서 안 시험 문구, 분류 경로·점수).
- **충돌:** 같은 URL 이 다른 슬롯에도 연결됨(빨강) · 이 슬롯에 다른 URL 이 이미 게시됨(노랑) · 같은 URL 이 이미 게시됨(확정적 중복).
- **짝 자료:** 같은 시험·슬롯의 문제↔정답·해설 상태.

자동 정리는 **확정적인 경우만** 합니다: [확정적 중복 정리] 는 같은 슬롯에 같은 URL 이 이미 게시된 검토 대기 행만 `failed(duplicate)` 로 닫습니다.
그 외(다른 URL, 다른 슬롯)는 사람이 판단하도록 남깁니다 — 검토 대기 수를 억지로 0 으로 만들지 않습니다.

근거 파일 붙이기 (브라우저 검증 기록 `{records:[…]}` 또는 `[{url, reasonCode?, reason?, evidence:[…]}]`):

```bash
npm run import:official-urls -- --evidence=verification.json --admin=ops@example.com   # CSV 없이 근거만
```

### 승인에서 배우는 매핑 규칙

EBSi 파일명 코드(예: `s_samun` → 사회·문화)가 승인되면 `review_mapping_rules` 에 규칙이 쌓입니다(승인 횟수 기록).
같은 코드가 다른 과목으로 승인되면 규칙은 확정적이지 않으므로 **삭제**됩니다.
공통 과목 코드, 학년에 따라 뜻이 바뀌는 코드(`sat`/`gat`), 짝수형/홀수형 등 변형, 고1 3월 자료는 규칙을 만들지 않습니다.

## 4-1. 후보 자동 생성 (공개 색인 결과 → CSV)

공개 검색 색인에서 모은 `[{url, title, query}]` JSON 으로 CSV 후보를 만듭니다. URL 을 만들거나 추측하지 않고, 입력 URL 만 분류합니다.

```bash
npm run import:candidates -- --in=found.json --out=data/imports/candidates.csv [--year=2025] [--check-urls]
npm run import:official-urls -- --file=data/imports/candidates.csv --admin=<email> --evidence=data/imports/candidates.csv.evidence.json
```

- 제목의 시험(연도·월·학년)·과목을 확인하고, 제목에 과목이 없으면 승인된 매핑 규칙 → 파일명 코드 순으로 분류합니다.
  확실하지 않으면 CSV 에 넣지 않고 `<out>.held.json` 에 사유와 함께 남깁니다 (과목 불일치 · 학년 모호 · 슬롯 충돌 · 변형 파일 …).
- 점수는 근거 강도(제목 확인 / 승인 규칙 / 코드 추정)이며, 어떤 점수든 **자동 게시하지 않습니다**. 모든 행은 검토 대기로 들어갑니다.
- `--check-urls`: 정책상 파일 요청이 허용된 호스트(현재 robots.txt 제한이 없는 `wdown.ebsi.co.kr`)만 SafeFetcher 로 앞 1KB 를 받아
  HTTP 200 · PDF 서명 · 오디오 형식을 확인합니다 (https · allowlist · redirect 재검증 · 사설 IP 차단 · 요청 간격). 실패하면 보류합니다.
  KICE·교육청 URL 은 요청하지 않습니다. 서버(웹 앱)는 여전히 입력 URL 에 요청하지 않습니다.
- `DATABASE_URL` 이 있으면 승인된 매핑 규칙을 재사용합니다.

## 5. 확인

```bash
npm run ingest:coverage -- --summary          # 연도별 · 학년별 · 자료 종류별 게시/대기/누락
npm run ingest:coverage -- --year=2025 --grade=3
npm run ingest:audit -- --json
```

## 현재 입력분

`data/imports/official-urls.csv` 에 검색엔진 색인에서 발견된 EBSi 공식 URL 309행(2023~2025년)이 있습니다. 브라우저 검증 도구는 `scripts/official-url-search/verify-browser.mts`(검증) · `contact-sheet.mts`(육안 대조용 캡처 모음) · `approve-admin.mts`(관리자 승인 폼으로 게시)입니다. 근거와 누락은 [REAL_DATA_COVERAGE.md](REAL_DATA_COVERAGE.md) 를 보세요.
