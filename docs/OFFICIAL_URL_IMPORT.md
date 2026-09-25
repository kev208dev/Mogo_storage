# 공식 파일 URL 입력 (운영자 CSV) 사용법

EBSi · 평가원(KICE) · 교육청 사이트는 robots.txt 로 자동 수집을 막고 있습니다 ([조사 기록](SOURCE_SURVEY.md)).
그래서 기출 자료는 **운영자가 브라우저에서 직접 확인한 공식 파일 URL** 을 CSV 로 입력하고, 관리자가 확인 후 승인하는
방식으로 등록합니다. 서버는 입력된 URL 에 **요청하지 않습니다** (검증 다운로드·재검증·단어장 추출 모두 제외).

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
   다운로드 버튼은 `/api/files/{id}/download` → 공식 URL 로 302 redirect 합니다 (우리 서버·R2 에 파일을 복제하지 않음).
4. 틀린 자료는 [선택 거절] (사유 입력). 공개되지 않습니다.

### 샘플 데이터와 섞이지 않음

개발용 샘플 시험과 같은 시험(연도·학년·월)에 실제 자료가 **승인되는 순간**, 그 시험의 샘플 내용(샘플 파일·문항·통계·등급컷·단어·듣기·샘플 일정)을 지우고
실제 시험(`is_sample=false`)으로 전환합니다. 승인 전에는 샘플 페이지가 그대로이고, 입력된 URL 은 공개되지 않습니다.
운영 DB 에는 `npm run db:seed`(샘플)를 실행하지 않는 것을 권장합니다.

## 5. 확인

```bash
npm run ingest:coverage -- --summary          # 연도별 · 학년별 · 자료 종류별 게시/대기/누락
npm run ingest:coverage -- --year=2025 --grade=3
npm run ingest:audit -- --json
```

## 현재 입력분

`data/imports/official-urls.csv` 에 검색엔진 색인에서 발견된 EBSi 공식 URL 309행(2023~2025년)이 있습니다. 근거와 누락은 [REAL_DATA_COVERAGE.md](REAL_DATA_COVERAGE.md) 를 보세요.
