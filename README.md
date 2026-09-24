# 모의고사 창고

한국 고등학생이 역대 모의고사 시험지·정답·해설 PDF를 **가장 빠르게 찾고 다운로드**할 수 있는 웹사이트입니다.

> 검색 → `/exam/2025/high2/09` 접속 → 과목 선택 → 시험지/정답·해설 다운로드
> 회원가입·중간 페이지 없이, 첫 화면에서 바로 다운로드할 수 있습니다.

⚠️ 이 저장소에는 **실제 시험지/해설지/음원이 포함되어 있지 않습니다.** 정답·해설·정답률·등급컷·단어장·듣기 대본 등은 모두 개발용 **샘플 데이터**이며, 화면에도 "샘플"로 표시됩니다.

## 기술 스택

Next.js 16 (App Router, TypeScript strict) · Tailwind CSS 4 · shadcn/ui 스타일 컴포넌트(Radix) · Lucide · PostgreSQL + Drizzle ORM · Zod · ESLint · Prettier · Vitest · Playwright

## 빠른 시작

```bash
npm install
npm run dev          # http://localhost:3000
```

환경변수 없이 실행하면 **샘플 데이터(in-memory) + mock 스토리지**로 동작합니다.

### PostgreSQL 사용

```bash
cp .env.example .env.local        # DATABASE_URL 설정
npm run db:migrate                # drizzle/ 마이그레이션 적용
npm run db:seed                   # 샘플 데이터 입력 (여러 번 실행해도 중복 없음)
npm run dev
```

`DATABASE_URL`이 설정되면 자동으로 Drizzle 저장소를 사용합니다. 스키마를 바꾼 뒤에는 `npm run db:generate`로 마이그레이션을 만드세요.

### 스크립트

| 명령                | 설명                                  |
| ------------------- | ------------------------------------- |
| `npm run dev`       | 개발 서버                             |
| `npm run build`     | 프로덕션 빌드 (시험 페이지 정적 생성) |
| `npm run typecheck` | `tsc --noEmit`                        |
| `npm run lint`      | ESLint                                |
| `npm run format`    | Prettier                              |
| `npm test`          | Vitest 단위 테스트                    |
| `npm run test:e2e`  | Playwright (먼저 `npm run build`)     |
| `npm run check`     | typecheck + lint + format + test      |
| `npm run db:*`      | generate / migrate / push / seed      |

## URL 구조

| URL                                         | 설명                                                    |
| ------------------------------------------- | ------------------------------------------------------- |
| `/exam/2025/high2/09`                       | 시험 상세 (기본 과목: 국어, canonical)                  |
| `/exam/2025/high2/09/english`               | 과목별 페이지 (math, english, history, social, science) |
| `/exam/2025/high3/09/social`                | 사회탐구 영역 페이지 (세부과목 선택)                    |
| `/exam/2025/high3/09/social/social-culture` | 세부과목 페이지 (사회·문화, `science/physics-1` 등)     |
| `/grade/high2`, `/year/2025`                | 학년별 / 년도별 목록                                    |
| `/search?q=25 고2 9모`                      | 자유 검색 → 해당 시험으로 redirect                      |
| `/api/files/[fileId]/download`              | 다운로드 (스토리지 URL로 302)                           |
| `/api/files/[fileId]/view`                  | 미리보기/재생 (inline)                                  |
| `/api/reports`                              | 오류 신고 (POST, Zod 검증)                              |

`/exam/2025/high2/9` → `/exam/2025/high2/09`, `/exam/.../korean` → 기본 URL로 영구 redirect 합니다.

## 구조

```
src/
  app/                      라우트 (Server Component 기본)
  components/
    exam/                   ExamHeader, SubjectTabs, FileDownloadCard, AnswerSheet,
                            AutoGrader*, QuestionExplorer*, QuestionStatistics,
                            DifficultQuestions, GradeCutTable, ReportDialog*
    english/                VocabularyList*, VocabularyQuiz*, ListeningPlayer*, DictationPractice*
    search/                 ExamFinder, ExamSearch  (JS 없이 동작하는 GET form)
    layout/                 Header, Footer, Breadcrumb(+JSON-LD), SampleNotice
    ui/                     shadcn/ui 컴포넌트 (button, badge, dialog, …)
  db/                       Drizzle schema, client, seed
  lib/
    data/                   ExamRepository 인터페이스 + Sample/Drizzle 구현, 샘플 데이터
    storage/                StorageProvider 인터페이스 + Mock/R2 구현
    exam-query-parser.ts    "25 고2 9모" → {year, grade, month}
    grading.ts, dictation.ts, vocabulary-quiz.ts, report-schema.ts
tests/unit, tests/e2e
```

`*` = Client Component (인터랙션이 필요한 곳만)

## 설계 메모

- **다운로드 우선 레이아웃**: 시험명 → 과목 → 시험자료 순서로 배치했습니다. 모바일(390×844)에서도 시험지·해설 다운로드 버튼이 첫 화면에 보입니다(e2e 테스트로 검증). 파일이 없으면 버튼을 숨기지 않고 "자료 준비 중"을 표시합니다.
- **스토리지 추상화**: `StorageProvider { getFileUrl, getDownloadUrl }`. `STORAGE_DRIVER=r2`이면 R2 구현을 사용합니다. 미리보기는 `R2_PUBLIC_BASE_URL`(CDN)을 쓰고, 다운로드는 credential이 있으면 SigV4 presigned URL(`response-content-disposition`로 한글 파일명 지정)을 씁니다. mock 구현은 placeholder PDF와 무음 오디오를 만들고 Range 요청을 지원합니다.
- **데이터 접근**: `ExamRepository` 인터페이스 하나에 의존합니다. `DATABASE_URL` 유무에 따라 Drizzle 구현과 샘플 구현 중 하나를 씁니다.
- **DB 설계**: `exams`(year·grade·month unique), `exam_subjects`, `exam_files`(exam·subject·type unique), `questions`(정답·배점·해설·solutionPage), `question_statistics`(출처별), `vocabulary`(문항 단위), `listening_tracks` + `listening_transcripts`(한 음원의 구간), `grade_cuts`(source·isOfficial·sourceUrl·isSample), `reports`(원본 IP 대신 일 단위 salt 해시).
- **등급컷**: 공식은 파란 열과 "공식" 배지로, 기관 자료는 "예상" 배지로 구분합니다. 외부 사이트를 scraping하지 않으며, 데이터는 수동으로 입력한다는 가정입니다.
- **오류 신고 abuse 방지**: body 크기 제한, same-origin 검사, honeypot 필드, IP 해시 기반 rate limit(메모리 + DB)을 적용했습니다.
- **SEO**: 시험·과목별 `generateMetadata`(canonical, OpenGraph), BreadcrumbList JSON-LD, `sitemap.xml`, `robots.txt`. 시험 페이지는 빌드 시 정적 생성하고 1시간마다 ISR로 갱신합니다.
  - 샘플 데이터(`isSample`) 시험은 **프로덕션에서 `noindex`** 처리해 가짜 정답이 검색에 노출되지 않게 했습니다. 샘플 데이터로 Lighthouse SEO를 측정하려면 `ALLOW_SAMPLE_INDEXING=1 npm run build`를 사용하세요. (기본값으로 설정하지 마세요.) 같은 조건의 샘플 시험은 sitemap에서도 빠집니다. 실제 데이터(`is_sample=false`, DB 기본값)는 자동으로 index됩니다.
- **성능**: 웹폰트 없이 OS 한글 폰트를 사용합니다. 검색 form은 JS 없이 동작하고, 정답 보기는 `<details>` 기반입니다. 듣기 음원은 `preload="none"`입니다.
- **접근성**: skip link, 보이는 focus ring, 주요 터치 타깃 44px, radio/fieldset 기반 입력, `aria-current`/`aria-pressed`/`aria-live`를 적용했고, 색상만으로 결과를 구분하지 않습니다.

## 에러 처리

| 상황                                | 처리                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| 존재하지 않는 시험 / 과목           | `notFound()` → 검색창이 있는 404 페이지                                   |
| 잘못된 URL parameter                | 404. 월이 `9`처럼 canonical이 아니면 `09`로 308 redirect                  |
| 자료 준비 중                        | 다운로드 링크 대신 비활성 "준비 중" 버튼 + "자료 준비 중" 배지            |
| 존재하지 않는 파일 id               | `/api/files/*` → 404 안내 HTML                                            |
| 파일 정보 조회 실패 (DB 장애)       | 503 "지금은 다운로드할 수 없습니다"                                       |
| 스토리지(R2) 오류                   | 502 "오류로 다운로드할 수 없습니다" (준비 중과 구분)                      |
| 데이터 없음 (정답/등급컷/단어장 등) | 섹션별 "준비 중" 안내                                                     |
| API validation 실패                 | 400 + 한국어 메시지와 필드명만 반환 (Zod 내부 구조 비노출)                |
| 기타 API                            | 403(origin) · 404 · 405 · 413 · 415 · 429 · 500(일반 메시지)              |
| 예상하지 못한 서버 오류             | `error.tsx` / `global-error.tsx`: 일반 안내 + digest만 표시, stack 비노출 |

내부 오류 상세는 서버 로그(`console.error`)에만 남기고 클라이언트 응답에는 넣지 않습니다.

## 자동 수집 (Automatic ingestion)

운영자가 시험 자료를 업로드하지 않습니다. 새 모의고사 날 운영자가 할 일은 **없음**이 목표입니다.

```
시험 일정 ─▶ release watch ─▶ 공식 자료 공개 탐지 ─▶ 검증 ─▶ DB 등록 ─▶ 사이트 즉시 반영
(exam_schedules)  (cron)          (source adapter)       (VERIFY)  (PUBLISH)   (revalidatePath)
```

**3분 요약:** `npm run ingest:backfill -- --dry-run` 을 실행하면 DB·네트워크 없이 합성 fixture 로
전체 흐름(시험 발견 → canonical identity → 자료 슬롯 → 제공 정책 → 사이트 URL)을 볼 수 있습니다.

### Architecture

```
src/ingestion/
  sources/            ExamSourceAdapter 구현 (외부 source → canonical 구조만 책임)
    ebsi/             structure.ts(구조 가정) · parser.ts(순수 함수) · adapter.ts
    kice/, education-office/   게시판형 공통 parser(board/) + source 별 structure
    config.ts         기본 source 설정(정책·요청 예절), 시험 유형별 우선순위
  canonical/          시험명 → {시행 연도, 학년, 월, 종류, 학년도}, 과목/자료 종류 정규화, 슬롯 dedupe
  net/                SafeFetcher (allowlist · SSRF 차단 · redirect 재검증 · robots.txt · rate limit)
  verify/             파일 검증 (status · MIME · magic bytes · 크기 · HTML 위장) + SHA-256
  pipeline/           discovery(run) · exam/mapping/artifact upsert · 우선순위 기반 publish · advisory lock
  jobs/               PostgreSQL job queue (FOR UPDATE SKIP LOCKED, backoff, maxAttempts) + handlers
  schedule/           시험 일정 · release window 계산
  vocabulary/         해설 PDF 텍스트 추출 · 단어 후보 추출 · 단어장 PDF 생성
  grade-cuts/         등급컷 source 정책 (사교육 예상치는 자동 수집 금지)
  backfill.ts         runBackfill (checkpoint)
  watch.ts            runReleaseWatch · runScheduledIngestion
  cli/                npm run ingest:* 진입점
```

처리 단계는 한 요청에 몰지 않고 분리합니다:

| 단계                  | 실행                                                 | 내용                                                             |
| --------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| DISCOVER              | `runDiscovery` (source 별 advisory lock)             | 시험·mapping·자료 슬롯을 idempotent 하게 기록, VERIFY job 생성   |
| VERIFY                | job `verify_artifact`                                | 공식 URL 다운로드 → 검증 → SHA-256 → 변경 감지                   |
| MIRROR / REGISTER_URL | (VERIFY 안)                                          | `mirror_allowed` 면 R2 저장, 아니면 URL 만 등록                  |
| PUBLISH               | job `publish_artifact`                               | 슬롯별 최우선 source 를 `exam_files` 에 반영 → 페이지 revalidate |
| PROCESS               | job `extract_vocabulary` → `generate_vocabulary_pdf` | 영어 해설 → 단어장 (선택)                                        |

- **Idempotent:** 모든 upsert 는 unique key 기반이며 job 은 dedupe key 로 한 번만 생성됩니다. 같은 backfill 을 10번 돌려도 row 수가 같다는 것을 통합 테스트로 검증합니다.
- **자료 단위 게시:** 문제지가 먼저 공개되면 문제지 버튼부터 즉시 활성화됩니다. 전체 자료를 기다리지 않습니다.
- **동시성:** job claim 은 `FOR UPDATE SKIP LOCKED` 를, source 별 discovery 와 정기 수집은 PostgreSQL advisory lock 을 사용합니다. 메모리 lock 은 쓰지 않습니다.

### Source adapter

```ts
interface ExamSourceAdapter {
  source: SourceConfig;
  discoverExams(options: DiscoverOptions): Promise<DiscoveredExam[]>;
  discoverArtifacts(exam: ExamLocator): Promise<DiscoveredArtifact[]>;
  healthCheck(): Promise<SourceHealth>;
}
```

| source             | 구현                        | 역할                                   | 상태                |
| ------------------ | --------------------------- | -------------------------------------- | ------------------- |
| `kice`             | `KiceExamSource`            | 6·9월 모의평가, 수능 원본 (우선순위 1) | ⚠️ 실제 구조 미검증 |
| `ebsi`             | `EbsiExamSource`            | 전 학년 기출 archive                   | ⚠️ 실제 구조 미검증 |
| `education_office` | `EducationOfficeExamSource` | 전국연합학력평가 출제 기관             | ⚠️ 실제 구조 미검증 |

> ⚠️ **중요:** 개발 환경의 네트워크 정책 때문에 ebsi.co.kr / suneung.re.kr 에 접근할 수 없어,
> 각 parser 는 `tests/fixtures/*` 의 **합성 fixture** 기준입니다. 아래 "실제 source 검증" 절차를 통과하기 전에는
> 어떤 source 도 자동 수집되지 않습니다 (코드와 DB 가 강제).

- **같은 시험, 여러 source:** "2026학년도 9월 모의평가", "2025년 9월 모의평가", "9월 모평" 은 모두 `2025-3-09 kice_mock` 하나의 Exam 으로 합쳐지고, 각 source 는 `source_exams` 로 연결됩니다.
- **우선순위** (`source_priorities`, 시험 유형별로 설정): 평가원 시험은 KICE → EBSi → 교육청, 학력평가는 교육청 → EBSi → KICE 순입니다. 원본성 기준이며 서비스 평가가 아닙니다.
- **학년도 vs 시행 연도:** URL·SEO 의 `year` 는 항상 **시행 연도**입니다. `2027학년도 수능`은 `/exam/2026/high3/11` 이 되고, `exams.academic_year = 2027` 로 따로 저장됩니다.
- **지원하지 않는 것:** 제2외국어·직업탐구는 건너뜁니다.

### 세부과목(선택과목) 모델

실제 모의고사는 한 영역 안에 여러 과목이 있습니다 (사회탐구 9과목, 과학탐구 Ⅰ·Ⅱ, 수학·국어 선택).

- `subject`(국어·수학·영어·한국사·사회·과학) 와 `course`(사회·문화, 물리학 I, 미적분 …) 를 분리했습니다.
  - `courses`: 카탈로그 (`code` 는 URL 에 쓰는 고정 식별자, `src/lib/courses.ts` 와 migration 0002 가 동기화)
  - `course_aliases`: 관리자가 확정한 표기 (source 별 또는 전체)
  - `exam_courses`: 시험별로 제공되는 세부과목
- `exam_files`, `source_artifacts`, `questions`, `grade_cuts` 에 nullable `course_id` 를 추가했습니다.
  - course 가 없는 자료(국어·영어·한국사, 영역 전체 자료)는 `course_id = NULL`
  - uniqueness 는 `course_id IS NULL` / `IS NOT NULL` partial unique index 두 개로 나눠 NULL 중복을 막습니다
  - `source_artifacts` 는 `slot_key`(`''` / course code / `unresolved:<표기>`)로 identity 를 표현합니다
- **기존 데이터:** 기존 사회·과학 자료는 `course_id = NULL` 로 그대로 둡니다. 특정 과목으로 임의 mapping 하지 않으며, 영역 페이지에 "사회탐구 전체 (세부과목 구분 없는 자료)" 로 표시됩니다.
- **정규화:** `사회문화`·`사회·문화`·`사문` → `social-culture`, `물리학1`·`물리Ⅰ`·`물리학 I`·`물1` → `physics-1`.
  - 정식 명칭은 가장 긴 일치가 우선입니다 ("생활과윤리문제" 는 "윤리" 가 아님).
  - 약칭은 단독 토큰일 때만 인정합니다.
- **모호한 표기:** "윤리", "지리", "물리", "화학" 처럼 과목을 확정할 수 없는 표기는 추정하지 않습니다.
  - 검증까지만 하고 `manual_review` 로 둡니다. 관리자가 `/admin/review` 에서 과목을 지정하면 표기가 alias 로 저장되어 다음 수집부터 자동 적용됩니다.
- **압축 파일:** 여러 과목이 든 zip 은 `container_type=archive` 로 표시만 하고, 압축 해제·게시는 하지 않습니다 (실제 fixture 확인 후 구현).
- **우선순위:** 같은 course 가 여러 source 에 있으면 슬롯(artifact) 단위로 우선순위를 계산합니다.
  - 예: KICE 에 사회·문화가 있으면 KICE 를 씁니다. KICE 에 생활과 윤리가 없으면 EBSi 자료를 씁니다.
- **실시간 공개:** course 단위로 즉시 게시합니다. 사회·문화가 공개되면 사회·문화만 게시되고, 아직 없는 생활과 윤리는 "자료 준비 중" 입니다.

### 실제 source 검증 (live fixture)

EBSi/KICE 의 실제 페이지를 보지 않은 상태에서 parser 가 맞다고 가정하지 않습니다.
실제 페이지 fixture 를 넣는 즉시 틀린 부분이 드러나는 구조입니다.

```bash
# 1) 네트워크가 되는 환경에서 실제 공개 페이지(HTML 만) 저장 — allowlist·robots.txt·요청 간격 준수, 저장 전 sanitize
npm run ingest:capture -- --source=ebsi --url="https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs?targetCd=D300" --grade=3 --year=2025
npm run ingest:capture -- --source=kice --url="<목록 URL>" --kind=board-list
npm run ingest:capture -- --source=kice --url="<게시글 URL>" --kind=board-detail --exam-title="2026학년도 9월 모의평가"

# 2) 저장된 모든 실제 fixture 를 parser 에 통과 (네트워크 없음, CI 에서도 실행)
npm run ingest:fixtures:validate

# 3) 틀린 부분 수정: src/ingestion/sources/<source>/structure.ts (selector/URL)
#    parser 파일이 바뀌면 단위 테스트가 버전 갱신을 요구한다
npm run ingest:parser-version

# 4) 통과하면 증거 기록 (DATABASE_URL)
npm run ingest:fixtures:validate -- --record

# 5) /admin 에서 [검증 승인] → [켜기]
```

- **fixture 형식:** `tests/fixtures/live/<source>/<name>.html` 과 `.json`(source, capturedAt, url, sha256, kind, context, expect) 입니다.
  - 저장 후 HTML 을 손으로 고치면 sha256 불일치로 실패합니다.
- **sanitizer:** 쿠키·세션 id(jsessionid 등), CSRF 토큰·nonce, 추적 parameter(utm_*, gclid …), 분석 스크립트, 로그인 개인화 영역, 이메일을 제거합니다.
- **parser contract:** 모든 source 가 `year, grade, month, examType, subject, course(nullable), artifactType, artifactUrl` 을 돌려줘야 합니다.
  - 필드 누락, 구조 변경, allowlist 밖 URL, 예상과 다른 빈 페이지는 실패로 처리합니다.
- **parser 버전:** `src/ingestion/sources/parser-versions.json` 에 parser 관련 파일 hash 와 버전이 고정됩니다.
  - 코드가 바뀌면 테스트가 실패하므로 `ingest:parser-version` 으로 버전을 올려야 합니다.
  - 버전이 바뀌면 이전 승인은 무효가 되어 다시 검증해야 합니다.
- **자동 수집 조건:** `enabled = true` AND 실제 fixture 검증 증거 AND 관리자 승인 AND 승인된 parser 버전 = 현재 버전.
  - `SOURCE_<ID>_ENABLED` 환경변수로는 우회할 수 없습니다.
  - 실제 fixture 검증이 실패하면 승인이 취소되고 source 가 꺼집니다.

### Artifact 정책 · 저작권

| 정책                           | 동작                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `source_redirect` (**기본값**) | 검증된 공식 URL 만 저장합니다. 다운로드 버튼을 누르면 공식 URL 로 바로 redirect 합니다.                        |
| `mirror_allowed`               | 재배포 허용이 **확인된** 경우에만 사용합니다. 다운로드 → checksum → R2 저장 → 우리 CDN/서명 URL 로 제공합니다. |
| `manual_review`                | 검증까지만 하고 공개하지 않습니다. 관리자 승인 후 공개됩니다.                                                  |

- 사용자 UX 는 항상 같습니다. 화면은 `/api/files/{id}/download` 만 알고, 서버가 `storage` 이면 R2 서명 URL 을, `redirect` 이면 공식 URL 을 선택합니다. 공식 URL 을 화면에 하드코딩하지 않습니다.
- 공개적으로 접근 가능한 공식 자료만 대상으로 합니다. 로그인, CAPTCHA, anti-bot, 비공개 API 는 우회하지 않고 robots.txt 를 따릅니다.
- 실제 시험 PDF 와 음원은 저장소에 절대 넣지 않습니다. 테스트 파일은 모두 코드로 생성한 placeholder 입니다.
- **provenance:** `source_artifacts` 에 source·sourceUrl·firstDiscoveredAt·sourcePublishedAt·verifiedAt·sha256 을 보존하고, 화면에는 `출처: EBSi` 로 표시합니다.

### Backfill

```bash
npm run ingest:backfill -- --dry-run                 # 구조 확인 (DB·네트워크 불필요)
npm run ingest:sources -- --enable=ebsi              # 검증된 source 만 켜기
INGESTION_ENABLED=true npm run ingest:backfill -- --source=ebsi --from=2015 --to=2026
npm run ingest:backfill -- --year=2025 --grade=2     # 범위 지정
npm run ingest:backfill -- --force                   # 완료된 checkpoint 도 다시 수집
npm run ingest:coverage -- --from=2015 --to=2026     # 누락 자료 확인 (세부과목 단위, 과목 미확정 포함, --json 지원)
```

- (source, 연도, 학년) 범위마다 `ingestion_checkpoints` 를 남깁니다. 중간에 실패해도 다시 실행하면 완료된 범위는 건너뜁니다.
- 처음에는 metadata 와 공식 URL 만 구축됩니다 (`source_redirect`).

### 시험 일정 · Release watch

```bash
npm run ingest:schedules -- --file=data/schedules/2027.json   # 공식 발표로 확인된 일정만
```

- 일정을 등록하면 시험 페이지가 미리 생성되고, "시험 예정 · 2027년 3월 24일 / 시험 자료는 시험 종료 후 업데이트됩니다" 를 표시합니다. 검색엔진용 가짜 내용은 만들지 않습니다.
- **평상시:** source 별로 6시간 간격으로 최근 2년을 확인합니다.
- **시험 당일 (release watch):** 예상 공개 시간대(기본: 시험일 12:00 ~ 다음 날 23:59 KST, 일정마다 조정 가능)에만 해당 시험을 짧은 간격으로 확인합니다.
  - 간격은 source 별 `minPollIntervalSeconds` 이며, 설정과 관계없이 최소 120초입니다.
  - 요청 예절도 source 별로 둡니다: `requestTimeoutMs`, `maxConcurrentRequests`, `minRequestGapMs`, `maxRetries`, robots.txt `crawl-delay`.
- 발견한 자료는 곧바로 검증·게시됩니다. 일정 상태는 `scheduled → watching → published → completed` 로 바뀝니다.
- 공개된 ready 자료는 7일마다 다시 받아 SHA-256 을 비교합니다. 내용이 바뀌었으면 `changed` 로 기록하고 재검증 후 재게시합니다.

### Scheduler 설정

수집 로직(`runScheduledIngestion`, `runReleaseWatch`, `runBackfill`)은 scheduler 와 독립적입니다. 다음 중 **하나**를 고르세요.

| 방식                    | 설정                                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Cron             | `vercel.json` 에 `{"crons":[{"path":"/api/cron/scheduled","schedule":"*/10 * * * *"}]}` 를 추가하고 `CRON_SECRET` 을 설정합니다 (Vercel 이 Bearer 로 전송).                                                |
| GitHub Actions          | `.github/workflows/scheduled-ingestion.yml` 를 사용합니다. repository variable `INGESTION_SCHEDULER=github-actions` 와 secrets `INGESTION_SITE_URL`, `CRON_SECRET` 을 설정합니다. 값이 없으면 skip 합니다. |
| Cloudflare Cron Trigger | Worker 의 `scheduled()` 에서 `fetch(SITE/api/cron/scheduled, {headers:{authorization:"Bearer "+CRON_SECRET}})` 를 호출합니다.                                                                              |
| Linux cron              | `*/10 * * * * cd /app && npm run ingest:scheduled` 로 실행합니다 (DB 에 직접 접속). 페이지 갱신은 `/api/internal/revalidate` 로 요청합니다.                                                                |
| 수동                    | `npm run ingest:scheduled`, `ingest:release-watch`, `ingest:jobs`                                                                                                                                          |

- endpoint 인증은 `Authorization: Bearer <CRON_SECRET>` 입니다. `CRON_SECRET` 이 없으면 404 를 반환하고, `INGESTION_ENABLED` 가 `true` 가 아니면 skip 합니다.
- `ingestion-health.yml` 은 매주 실제 source 에 health check 를 보냅니다. CI 테스트·build 와는 분리되어 있습니다.

### 운영 Dashboard (`/admin`)

- **인증:** `ADMIN_EMAIL_ALLOWLIST` + `ADMIN_ACCESS_TOKEN` 을 확인한 뒤 서명된 세션(12시간)을 발급합니다.
  - `proxy.ts` 와 각 페이지·action 에서 이중으로 확인합니다.
  - 세 값 중 하나라도 없으면 `/admin` 전체가 404 가 됩니다. 가능하면 배포 플랫폼의 접근 보호도 함께 켜세요.
- **수집 현황:** source health(정상/주의/고장/꺼짐, 마지막 성공, 연속 실패), 시험별 자료 표(문제 ✓ 해설 ✗ 듣기 …), 실패 목록과 [다시 시도] 를 보여줍니다.
- **운영자 작업:** source 켜기/끄기, 지금 수집, manual review 승인·거절, 단어 후보 검토, source mapping 수정(수정하면 고정되어 자동 수집이 되돌리지 않음), 실행 기록·오류 확인, 오류 신고 처리를 할 수 있습니다.
- 파일 업로드 UI 는 없습니다. 모든 작업은 같은 job 파이프라인을 거치고 감사 로그가 남습니다.

### 실패 복구

| 증상                                           | 확인                                   | 조치                                                                                                     |
| ---------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| source `고장` + `SOURCE_STRUCTURE_CHANGED`     | `/admin/runs`, `npm run ingest:health` | 사이트 개편입니다. `ingest:fixtures` 로 새 구조를 저장하고 `structure.ts` 를 수정한 뒤 배포, [지금 수집] |
| `ROBOTS_DISALLOWED`                            | 오류 목록                              | 해당 경로는 수집하지 않습니다. source 를 끄고 대체 source 를 사용하세요.                                 |
| 자료 `failed` (HTML_RESPONSE, INVALID_MAGIC …) | 대시보드 실패 목록                     | 원본을 확인한 뒤 [다시 시도] 하세요. 공식 URL 이 바뀌었다면 다음 discovery 가 자동으로 반영합니다.       |
| job `failed` (재시도 소진)                     | 대시보드                               | 원인을 해결하고 [실패 job 전체 다시 시도] 를 누르세요.                                                   |
| 잘못된 시험에 연결됨                           | `/admin/mappings`                      | 올바른 연도·학년·월로 이동하면 mapping 이 고정됩니다.                                                    |
| 처리 중에 프로세스 종료                        | 자동                                   | 15분 이상 `processing` 으로 남은 job 은 다음 실행에서 자동으로 복구됩니다.                               |

모든 이벤트는 한 줄 JSON 으로 기록됩니다: `ingestion.started`, `exam.discovered`, `artifact.discovered`, `artifact.verified`, `artifact.published`, `artifact.changed`, `ingestion.failed`, `ingestion.completed` 등. URL query 와 secret 은 로그에서 제거됩니다.
알림은 `OpsNotifier` 인터페이스로 분리되어 있습니다. 기본 구현은 로그만 남기며, Slack/Discord 구현체를 추가해 연결할 수 있습니다.

### 영어 단어장 pipeline

영어 해설이 게시되면 다음 순서로 처리됩니다.

1. 해설 PDF 에서 텍스트를 추출하고 문항(18~45번)별로 나눕니다.
2. 원문에 실제로 있는 "영단어 + 한국어 뜻" 줄만 후보로 저장합니다. LLM 은 쓰지 않고 단어를 만들어내지 않습니다.
3. `[어휘]` 섹션 안의 항목은 신뢰도가 높아 자동 승인하고, 나머지는 `needs_review` 로 남겨 관리자가 검토합니다.
4. 승인된 단어로 우리가 만든 단어장 PDF 를 생성합니다 (Noto Sans KR, OFL). 이 PDF 는 `artifact_origin=generated` 로 공식 자료와 분리됩니다.

## 측정 결과 (로컬 production build, Lighthouse 13)

| 페이지                        | Performance | Accessibility | Best Practices | SEO  |
| ----------------------------- | ----------- | ------------- | -------------- | ---- |
| `/` (mobile / desktop)        | 99 / 100    | 100           | 100            | 100  |
| `/exam/2025/high2/09/english` | 97 / 100    | 100           | 100            | 100* |

\* `ALLOW_SAMPLE_INDEXING=1`로 빌드한 경우입니다. 이 설정이 없으면 샘플 페이지는 의도대로 noindex 처리됩니다.

## 향후 작업

- **운영 전 필수:** 각 source 의 실제 페이지를 capture → validate → 승인 (위 절차). 이용조건 확인
- 실제 fixture 에서 여러 과목 zip 이 확인되면 archive 처리 구현
- 공식 등급 구분 점수가 공개되는 형식을 확인한 뒤 automated grade-cut adapter 추가
- Slack/Discord `OpsNotifier` 구현
- 다중 인스턴스 배포 시 오류 신고 rate limiter 를 공유 저장소로 이전
