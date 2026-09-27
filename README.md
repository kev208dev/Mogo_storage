# 모의고사 창고

## 등급컷 감시

`/api/cron/grade-cuts`는 `CRON_SECRET` Bearer 인증을 재사용합니다. 5분 호출은 운영 DB(Supabase)의
pg_cron + pg_net 이 합니다 (Vercel Hobby 는 5분 Cron 배포를 거절하고, GitHub Actions schedule 은
이 저장소에서 2~4시간 간격으로만 실행돼 5분 주기를 보장하지 못했습니다). 설치·상태 확인은 GitHub Actions
`DB scheduler (pg_cron)` workflow 또는 `npm run ops:db-scheduler` 로 합니다 ([docs/OPERATIONS.md](docs/OPERATIONS.md)).
GitHub `Grade cut watch` 는 수동 실행용으로만 남아 있습니다 (저장소 변수 `GRADE_CUT_SCHEDULER=github-actions` 필요).
`GRADE_CUT_INGESTION_ENABLED=true`를 별도로 설정해야 실행됩니다. 기본값은 꺼짐이며
`INGESTION_ENABLED`와 무관합니다. 운영 DB가 Supabase migration tracking을 사용한다면
`drizzle/0009_grade_cut_watch.sql`을 해당 migration 절차로 적용·확인한 뒤 활성화하세요.
Drizzle 추적 테이블이 없는 DB에 `db:migrate:prod`를 바로 실행하면 이전 migration 재적용 위험이 있습니다.

시험 유형별 KST 보수적 종료 시각 이후 과목/세부과목 슬롯을 감시합니다.
시험 종료 이후 공식 원점수 컷이 확인될 때까지 미확정 슬롯을 5분마다 확인합니다.
공식컷이 저장된 슬롯은 finalized로 남고 예상컷 adapter에서 제외됩니다.
영어·한국사와 해당 시험 체제에서 절대평가인 제2외국어/한문은 감시 슬롯과
시험별 grade_cuts 행을 만들지 않고 고정 원점수 등급표로 표시·계산합니다.
수집값의 첫 관측과 변경만 `grade_cut_snapshots`에 기록합니다.
현재 검증된 MegaStudy 자동 adapter는 공개 원점수 표에서 확인된 시험·과목 조합만 수집합니다.
공식 확정값과 업체 예상값은 각각의 출처와 상태를 보존해 표시합니다.
대성/EBS/공식 원점수 adapter는 검증 전까지 요청하지 않습니다.
관리자 `/admin/grade-cuts`의 수동/CSV 보정은 계속 사용할 수 있습니다.

출처별 검증 및 활성화 조건은 [등급컷 출처 조사](docs/GRADE_CUT_SOURCES.md)를 참고하세요.

한국 고등학생이 역대 모의고사 시험지·정답·해설 PDF를 **가장 빠르게 찾고 다운로드**할 수 있는 웹사이트입니다.

> 검색 → `/exam/2025/high2/09` 접속 → 과목 선택 → 시험지/정답·해설 다운로드
> 회원가입·중간 페이지 없이, 첫 화면에서 바로 다운로드할 수 있습니다.

⚠️ 이 저장소에는 **실제 시험지/해설지/음원이 포함되어 있지 않습니다.** 정답·해설·정답률·등급컷·단어장·듣기 대본 등은 모두 개발용 **샘플 데이터**이며, 화면에도 "샘플"로 표시됩니다.

운영 문서: [docs/OPERATIONS.md](docs/OPERATIONS.md) (상황별 대응 · 백업/복구 · scheduler 감시 · smoke test) · [docs/ADDING_SOURCE.md](docs/ADDING_SOURCE.md) (공식 source 추가)

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
docker compose -f docker-compose.dev.yml up -d   # 로컬 PostgreSQL (선택)
cp .env.example .env.local        # DATABASE_URL 설정
npm run db:migrate:prod           # drizzle/ 마이그레이션 적용 + 세부과목 카탈로그·source 기본값 동기화
npm run db:seed                   # 샘플 데이터 입력 (여러 번 실행해도 중복 없음, 개발용)
npm run dev
```

`DATABASE_URL`이 설정되면 자동으로 Drizzle 저장소를 사용합니다. 스키마를 바꾼 뒤에는 `npm run db:generate`로 마이그레이션을 만드세요.

### 스크립트

| 명령                         | 설명                                                |
| ---------------------------- | --------------------------------------------------- |
| `npm run dev`                | 개발 서버                                           |
| `npm run build`              | 프로덕션 빌드 (시험 페이지 정적 생성)               |
| `npm run typecheck`          | `tsc --noEmit`                                      |
| `npm run lint`               | ESLint                                              |
| `npm run format`             | Prettier                                            |
| `npm test`                   | Vitest 단위 테스트                                  |
| `npm run test:e2e`           | Playwright (먼저 `npm run build`)                   |
| `npm run check`              | typecheck + lint + format + test                    |
| `npm run db:*`               | generate / migrate / push / seed                    |
| `npm run db:migrate:prod`    | 운영 migration (drizzle-kit 없이) + 카탈로그 동기화 |
| `npm run ingest:*`           | 자동 수집 CLI (아래 "자동 수집")                    |
| `npm run storage:selftest`   | R2 실제 연결 점검 (`_internal/test/` 만 사용)       |
| `npm run test:smoke:prod`    | 배포된 사이트 읽기 전용 smoke (`SMOKE_BASE_URL`)    |
| `npm run ops:scheduler`      | cron heartbeat 상태 (`--watchdog` 이면 알림까지)    |
| `npm run ops:restore-verify` | 복원한 DB 무결성 점검 (읽기 전용)                   |

## URL 구조

| URL                                         | 설명                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `/exam/2025/high2/09`                       | 시험 상세 (기본 과목: 국어, canonical)                                               |
| `/exam/2025/high2/09/english`               | 과목별 페이지 (math, english, history, social, science, vocational, second-language) |
| `/exam/2025/high3/09/social`                | 사회탐구 영역 페이지 (세부과목 선택)                                                 |
| `/exam/2025/high3/09/social/social-culture` | 세부과목 페이지 (사회·문화, `science/physics-1` 등)                                  |
| `/grade/high2`, `/year/2025`                | 학년별 / 년도별 목록                                                                 |
| `/search?q=25 고2 9모`                      | 자유 검색 → 해당 시험으로 redirect                                                   |
| `/api/files/[fileId]/download`              | 다운로드 (스토리지 URL로 302)                                                        |
| `/api/files/[fileId]/view`                  | 미리보기/재생 (inline)                                                               |
| `/api/reports`                              | 오류 신고 (POST, Zod 검증)                                                           |
| `/api/health`                               | `{app, database}` 상태만 (민감정보 없음)                                             |
| `/api/cron/{scheduled,release-watch,jobs}`  | scheduler 진입점 (`Authorization: Bearer CRON_SECRET`)                               |

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

| source             | 구현                        | 역할                                   | 상태                                                                         |
| ------------------ | --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `kice`             | `KiceExamSource`            | 6·9월 모의평가, 수능 원본 (우선순위 1) | ⛔ robots `Disallow: /` — 자동 수집 불가                                     |
| `ebsi`             | `EbsiExamSource`            | 전 학년 기출 archive                   | ⛔ robots `Disallow: /*.ajax$` (archive 가 .ajax 로만 제공) — 자동 수집 불가 |
| `education_office` | `EducationOfficeExamSource` | 전국연합학력평가 출제 기관             | ⛔ robots 허용 자료실 없음 (합성 가정, disabled)                             |
| `operator_import`  | 운영자 CSV 입력             | 운영자가 브라우저로 확인한 공식 URL    | ✅ 서버는 URL 에 요청하지 않음, 관리자 승인 후 redirect 게시                 |

> ⚠️ **중요:** 개발 환경의 네트워크 정책 때문에 ebsi.co.kr / suneung.re.kr 에 접근할 수 없어,
> 각 parser 는 `tests/fixtures/*` 의 **합성 fixture** 기준입니다. 아래 "실제 source 검증" 절차를 통과하기 전에는
> 어떤 source 도 자동 수집되지 않습니다 (코드와 DB 가 강제).

- **같은 시험, 여러 source:** "2026학년도 9월 모의평가", "2025년 9월 모의평가", "9월 모평" 은 모두 `2025-3-09 kice_mock` 하나의 Exam 으로 합쳐지고, 각 source 는 `source_exams` 로 연결됩니다.
- **우선순위** (`source_priorities`, 시험 유형별로 설정): 평가원 시험은 KICE → EBSi → 교육청, 학력평가는 교육청 → EBSi → KICE 순입니다. 원본성 기준이며 서비스 평가가 아닙니다.
- **학년도 vs 시행 연도:** URL·SEO 의 `year` 는 항상 **시행 연도**입니다. `2027학년도 수능`은 `/exam/2026/high3/11` 이 되고, `exams.academic_year = 2027` 로 따로 저장됩니다.
- **영역:** 국어 · 수학 · 영어 · 한국사(`history`) · 사회탐구 · 과학탐구 · 직업탐구(`vocational`) · 제2외국어/한문(`second_language`, URL `second-language`, 예: `/exam/2025/high3/07/second-language/japanese-1`. enum 경로 `/second_language/...` 는 308 로 정식 URL 로 이동).
  과목 탭은 하드코딩하지 않고 시험에 실제로 있는 영역(`exam_subjects`)만 보여줍니다.

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

### 시험 체제 (regime) — 과거·미래 시험을 현재 과목 체계로 강제하지 않기

"특정 연도·학년의 시험에 어떤 세부과목이 있을 수 있는가"만 표현합니다 (`src/lib/regimes.ts`).
체제는 학생이 치를 수능 학년도(cohort = 시행연도 + 4 − 학년)로 고릅니다.

| 체제        | cohort       | 세부과목 검증                                                             |
| ----------- | ------------ | ------------------------------------------------------------------------- |
| `legacy`    | ~2021학년도  | 목록 없음 → 정확한 과목명·관리자 alias 만 인정, 약칭은 검토               |
| `csat_2022` | 2022~2027    | 국어·수학 선택, 사탐 9, 과탐 8, 직탐 6, 제2외국어/한문 9 (학년 조건 포함) |
| `csat_2028` | 2028~ (잠정) | 통합사회·통합과학 등. 목록 밖 과목은 manual_review                        |

- 체제에 없는 카탈로그 판정(예: 2028 체제 시험의 "물리학Ⅰ")은 확정하지 않고 manual_review 로 보냅니다. source 표기는 덮어쓰지 않습니다.
- source 원문은 `source_artifacts.source_label` / `source_subject_label` / `course_label` 에 항상 보존합니다 (예: 원문 "사회·문화" ↔ canonical `social-culture`).
- 관리자 alias 는 "이 시험 체제에만" 저장할 수 있습니다 (과거 표기 "물리Ⅰ" 을 2028 체제에 퍼뜨리지 않음).
- 직업탐구·제2외국어 course 행은 새 enum 값 제약 때문에 migration 이 아니라 `db:migrate:prod`/`ingest:sources`/`db:seed` 의 카탈로그 동기화가 넣습니다.

### 운영자 공식 URL 입력 (CSV import)

robots.txt 가 자동 요청을 막는 EBSi·KICE·교육청 자료는 우회하지 않습니다 (조사 결과: [docs/SOURCE_SURVEY.md](docs/SOURCE_SURVEY.md)).
대신 운영자가 브라우저에서 확인한 공식 파일 URL 을 CSV 로 대량 입력하고, 관리자가 확인 후 승인합니다.

- 템플릿: `data/imports/official-urls.template.csv`, 사용법: [docs/OFFICIAL_URL_IMPORT.md](docs/OFFICIAL_URL_IMPORT.md)
- 입력: 관리자 `/admin/imports` 또는 `npm run import:official-urls -- --file=<csv> --admin=<email> [--dry-run]`
- 서버는 입력된 URL 을 크롤링·검증하지 않고 `manual_review` 로 저장합니다. 재검증 job·단어장 추출에서도 제외됩니다.
- 관리자가 [공식 URL 열기]로 실제 파일을 확인하고 "브라우저 확인" 에 체크한 뒤 승인하면 `exam_files.delivery_type=redirect` 로 게시됩니다.
- 같은 CSV 를 다시 넣어도 결과는 같습니다 (idempotent). URL 이 바뀐 슬롯만 다시 검토 대기가 됩니다.
- 샘플 시험에 실제 자료가 승인되면 그 시험의 샘플 파일·문항·등급컷 등을 제거하고 실제 시험으로 전환합니다.
- 실제 데이터 coverage: `npm run ingest:coverage -- --summary`
- 시험별 기능 상태: `npm run ingest:coverage -- --features [--year=2025] [--json]` · 관리자 `/admin/coverage` — 시험지·해설 / 정답·채점 / 등급컷 / 영어 듣기 / 단어장을 complete · partial · manual_review · missing · blocked_policy(정책상 수동) · not_applicable 로 표시
- 후보 생성: `npm run import:candidates -- --in=<found.json> --out=<csv> [--check-urls]` (공개 색인 결과만, 확실하지 않으면 보류). 검토 대기 행에는 보류 사유·근거·URL 충돌·짝 자료가 보이고, 승인된 파일명 코드→세부과목 매핑은 규칙으로 재사용됩니다.
- source × 기능 정책: `src/ingestion/sources/policy.ts` — robots 등으로 금지된 기능은 켤 수 없음 (`npm run ingest:sources -- --matrix`, `/admin`).
- 현재 입력분: `data/imports/official-urls.csv` (2023~2025년 309행 중 288행은 브라우저 검증 후 관리자 승인으로 게시, 21행은 `manual_review`). 수집 방법·근거·누락은 [docs/REAL_DATA_COVERAGE.md](docs/REAL_DATA_COVERAGE.md)

### 공식 정답표 추출 (정답 · 배점 · 해설 쪽)

- `npm run answers:extract -- --year=2025 [--dry-run] [--publish]` — 게시된 공식 정답·해설 PDF 와 문제지에서 정답·배점·해설 쪽을 추출
- 정책상 허용된 파일 서버(EBSi)만 요청, 문항 수·연속성·값 범위·본문 정답 표기·배점 합계를 모두 검증한 슬롯만 게시
- 결과와 보류 사유: `answer_key_extractions` (migration 0013). 자세한 규칙: [docs/ANSWER_KEYS.md](docs/ANSWER_KEYS.md)

### 실제 source 검증 (live fixture)

EBSi/KICE 의 실제 페이지를 보지 않은 상태에서 parser 가 맞다고 가정하지 않습니다.
실제 페이지 fixture 를 넣는 즉시 틀린 부분이 드러나는 구조입니다.

```bash
# 1) 네트워크가 되는 환경에서 실제 공개 페이지(HTML 만) 저장 — allowlist·robots.txt·요청 간격 준수, 저장 전 sanitize
npm run ingest:capture -- --source=ebsi --page-type=exam_list --grade=3 --year=2025
npm run ingest:capture -- --source=kice --page-type=exam_list --url="<목록 URL>"
npm run ingest:capture -- --source=kice --page-type=exam_detail --url="<게시글 URL>" --exam-title="2026학년도 9월 모의평가"
npm run ingest:capture -- --source=kice --page-type=exam_release_index --url="<공지의 시험별 자료 페이지>" \
  --exam-title="2026학년도 대학수학능력시험" --exam-date=2025-11-13
#    → 저장된 .json 의 expected 요약(시험 수·영역·자료 수)을 실제 페이지와 대조한 뒤 expectedReviewed: true 로 바꾼다

# 1-1) 읽기 전용 진단 (DB 변경 없음)
npm run ingest:inspect -- --source=ebsi --year=2026 --grade=3 --month=9

# 2) 저장된 모든 실제 fixture 를 parser 에 통과 (네트워크 없음, CI 에서도 실행)
npm run ingest:fixtures:validate

# 3) 틀린 부분 수정: src/ingestion/sources/<source>/structure.ts (selector/URL)
#    parser 파일이 바뀌면 단위 테스트가 버전 갱신을 요구한다
npm run ingest:parser-version

# 4) 통과하면 증거 기록 (DATABASE_URL)
npm run ingest:fixtures:validate -- --record

# 5) /admin 에서 [검증 승인] → [health check] → [켜기] → 기능 단계별 켜기 (시험 목록 → 자료 수집 → 시험일 감시)
```

- **fixture 형식:** `tests/fixtures/live/<source>/<name>.html` 과 `.json`(source, pageType, url, capturedAt, sha256, parserVersion, examIdentity, context, expected, expectedReviewed) 입니다.
  - pageType: `exam_list` · `exam_detail` · `exam_release_index` · `listening_archive` · `schedule`
  - 저장 후 HTML 을 손으로 고치면 sha256 불일치로 실패합니다.
  - parse 가 성공해도 expected 요약(시험 수, 포함 영역·세부과목, 최소 자료 수, 공개 시각 수)과 다르면 "구조 변경 가능성"으로 실패합니다.
  - `expectedReviewed: false` 인 fixture 는 검증 증거로 쓰지 않습니다 (parser 가 맞다고 추측해서 verified 처리하지 않음).
- **sanitizer:** 쿠키·세션 id(jsessionid 등), CSRF 토큰·nonce, 추적 parameter(utm_*, gclid …), 분석 스크립트, 로그인 개인화 영역, 이메일을 제거합니다.
- **parser contract:** 모든 source 가 `year, grade, month, examType, subject, course(nullable), artifactType, artifactUrl` 을 돌려줘야 합니다.
  - 필드 누락, 구조 변경, allowlist 밖 URL, 예상과 다른 빈 페이지는 실패로 처리합니다.
- **parser 버전:** `src/ingestion/sources/parser-versions.json` 에 parser 관련 파일 hash 와 버전이 고정됩니다.
  - 코드가 바뀌면 테스트가 실패하므로 `ingest:parser-version` 으로 버전을 올려야 합니다.
  - 버전이 바뀌면 이전 승인은 무효가 되어 다시 검증해야 합니다.
- **켜기 조건 (production 활성화):** live fixture 존재 + fixture validation 통과(증거 기록) + 현재 parserVersion 과 fixture parserVersion 일치 + 관리자 승인 + 24시간 내 health check 통과.
- **기능 단위 활성화:** `discovery`(시험 metadata) → `artifacts`(자료 URL·검증·게시) → `release_watch`(시험일 감시) 순서로만 켤 수 있습니다.
  - `SOURCE_<ID>_ENABLED` 환경변수로는 우회할 수 없습니다.
  - 실제 fixture 검증이 실패하면 승인이 취소되고 source 와 모든 기능이 꺼집니다.
- **source health:** `unverified` · `healthy` · `degraded`(부분 실패) · `structure_changed`(구조/robots/404 — 사람 확인 전까지 중단) · `network_error`(timeout·5xx·429·403 — 재시도) · `disabled`. 구조 변경과 네트워크 장애를 같은 값으로 묶지 않습니다.
- **KICE 시험별 자료 표:** `KiceExamIndexParser` 는 CSS selector 대신 표 머리글(교시·시험영역·정답 공개시간·문제·정답·듣기평가·음성대본)로 열을 찾습니다. index URL 은 운영자가 공식 공지에서 확인해 일정 파일의 `sourcePages` 에 등록합니다 (URL 규칙을 추측하지 않음).
- **영어 듣기 페이지:** `listening_archive` parser 는 MP3·대본만 수집하고, 듣기 문제·정답 PDF 는 본 시험 영어 슬롯을 덮어쓰지 않도록 건너뜁니다. ZIP 은 압축 해제하지 않고 검토 대상으로 둡니다.

### Artifact 정책 · 저작권

| 정책                           | 동작                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `source_redirect` (**기본값**) | 검증된 공식 URL 만 저장합니다. 다운로드 버튼을 누르면 공식 URL 로 바로 redirect 합니다.                        |
| `mirror_allowed`               | 재배포 허용이 **확인된** 경우에만 사용합니다. 다운로드 → checksum → R2 저장 → 우리 CDN/서명 URL 로 제공합니다. |
| `manual_review`                | 검증까지만 하고 공개하지 않습니다. 관리자 승인 후 공개됩니다.                                                  |

- 사용자 UX 는 항상 같습니다. 화면은 `/api/files/{id}/download` 만 알고, 서버가 `storage` 이면 R2 서명 URL 을, `redirect` 이면 공식 URL 을 선택합니다. 공식 URL 을 화면에 하드코딩하지 않습니다.
- 공개적으로 접근 가능한 공식 자료만 대상으로 합니다. 로그인, CAPTCHA, anti-bot, 비공개 API 는 우회하지 않고 robots.txt 를 따릅니다.
- 실제 시험 PDF 와 음원은 저장소에 절대 넣지 않습니다. 테스트 파일은 모두 코드로 생성한 placeholder 입니다.
- **provenance:** `source_artifacts` 에 source·sourceUrl·finalUrl·deliveryPolicy·firstDiscoveredAt·sourcePublishedAt·verifiedAt·contentFingerprint(·sha256) 를 보존하고, 화면에는 `출처: EBSi` 로 표시합니다.
- **검증 방식:** `source_redirect`/`manual_review` 는 파일 전체를 받지 않고 앞 4KB + header 로 HTTP status·Content-Type·magic bytes·크기(content-length)·redirect 최종 도메인(allowlist)을 확인합니다 (`verification_mode=probe`). `mirror_allowed` 만 전체를 받아 SHA-256 후 R2 에 저장합니다.
- **R2 key:** `exams/{year}/high{grade}/{MM}/{subject}/{course?}/{type}-{sha16}.pdf`, 생성 자료는 `generated/exams/...`. 외부 파일명은 key 로 쓰지 않습니다.

### Backfill

```bash
npm run ingest:backfill -- --dry-run                 # 구조 확인 (DB·네트워크 불필요)
# canary: 최근 1년 → audit → 최근 3년 → audit → 전체 (앞 단계 audit 통과 기록이 없으면 넓은 범위는 거부)
INGESTION_ENABLED=true npm run ingest:backfill -- --source=ebsi --from=2025 --to=2026 --metadata-only
npm run ingest:audit -- --source=ebsi --from=2025 --to=2026 --record      # blocking 0 이면 다음 단계 허용
INGESTION_ENABLED=true npm run ingest:backfill -- --source=ebsi --from=2023 --to=2026
npm run ingest:audit -- --source=ebsi --from=2023 --to=2026 --record
INGESTION_ENABLED=true npm run ingest:backfill -- --source=ebsi --from=<source 가 보여주는 가장 오래된 연도> --to=2026
npm run ingest:backfill -- --force                   # 완료된 checkpoint 도 다시 수집
npm run ingest:coverage -- --from=2015 --to=2026     # 누락 자료 확인 (세부과목 단위, 과목 미확정 포함, --json 지원)
npm run ingest:audit -- --json                       # 중복·URL·도메인·MIME·누락·미확정·provenance·공개 후 미발견
```

- (source, 연도, 학년, 모드) 범위마다 `ingestion_checkpoints` 를 남깁니다. 중간에 실패해도 다시 실행하면 완료된 범위는 건너뜁니다.
- `--metadata-only`: Exam · ExamSubject · SourceExam · SourceArtifact(공식 URL) 까지만 만들고 파일 검증·다운로드·게시는 하지 않습니다. 이후 전체 수집 때 검증합니다.
- 시작 연도는 코드에 가정하지 않습니다. source 가 제공하는 archive 범위를 `ingest:inspect` 로 확인해 지정합니다.
- 시험은 있는데 일부 파일이 없으면 시험을 지우지 않고 coverage/audit 에 누락으로 표시합니다.

### 시험 일정 · Release watch

```bash
npm run ingest:schedules -- --file=data/schedules/2027.json   # 공식 발표로 확인된 일정만
```

- 일정을 등록하면 시험 페이지가 미리 생성되고, "시험 예정 · 2027년 3월 24일 / 시험 자료는 시험 종료 후 업데이트됩니다" 를 표시합니다. 검색엔진용 가짜 내용은 만들지 않습니다.
- **평상시:** source 별로 6시간 간격으로 최근 2년을 확인합니다.
- **시험 당일 (release watch):** 자료 단위(`artifact_watch_states`: 시험·영역·세부과목·종류)로 남은 자료만 확인합니다.
  - 확인 시작 시각: source 공식 공개 시각(KICE 표의 "국어 10:56" 등) > 일정 metadata > 기본 시간대(시험일 12:00 ~ 다음 날 23:59 KST). 시각은 하드코딩하지 않습니다.
  - 공개 2분 전부터 낮은 빈도(최소 간격 ×2), 공개 이후 source 최소 간격, 공식 시각 2시간 뒤에도 없으면 간격 ×3.
  - 이미 확보한 자료(found)는 다시 확인하지 않습니다. 영어 음원만 늦으면 음원만 기다립니다. 모든 슬롯이 found 면 감시 종료.
  - 공개 시간대가 끝났는데 없는 슬롯은 `missed` 가 되고 운영 알림을 보냅니다.
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
- **수집 현황:** source health(정상/주의/구조 변경/네트워크 오류/미검증/꺼짐, 마지막 성공, 연속 실패, health check), 켜기 전 남은 조건, 시험별 자료 표(문제 ✓ 해설 ✗ 듣기 …), 실패 목록과 [다시 시도]/[무시] 를 보여줍니다.
- **운영자 작업:** health check, 검증 승인·취소, source 켜기/끄기, 기능 단계별 켜기, 지금 수집, manual review 승인·거절, 과목 미확정 자료 과목 지정(source/전체/시험 체제 범위 alias), 단어 후보 검토, source mapping 수정, 실행 기록·오류 확인, 영구 실패 job 재시도·무시, 오류 신고 처리(접수→확인 중→해결/기각).
- 파일 업로드 UI 는 없습니다. 모든 작업은 같은 job 파이프라인을 거치고 감사 로그가 남습니다.

### 실패 복구

| 증상                                            | 확인                                   | 조치                                                                                                  |
| ----------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| source `구조 변경` + `SOURCE_STRUCTURE_CHANGED` | `/admin/runs`, `npm run ingest:health` | 사이트 개편입니다. `ingest:capture` 로 새 구조를 저장하고 `structure.ts` 를 수정 → 재검증·승인 → 배포 |
| `ROBOTS_DISALLOWED`                             | 오류 목록                              | 해당 경로는 수집하지 않습니다. source 를 끄고 대체 source 를 사용하세요.                              |
| 자료 `failed` (HTML_RESPONSE, INVALID_MAGIC …)  | 대시보드 실패 목록                     | 원본을 확인한 뒤 [다시 시도] 하세요. 공식 URL 이 바뀌었다면 다음 discovery 가 자동으로 반영합니다.    |
| job `failed` (재시도 소진)                      | 대시보드                               | 원인을 해결하고 [다시 시도], 의미 없는 job 은 [무시] (`dismissed`)                                    |
| 잘못된 시험에 연결됨                            | `/admin/mappings`                      | 올바른 연도·학년·월로 이동하면 mapping 이 고정됩니다.                                                 |
| 처리 중에 프로세스 종료                         | 자동                                   | 15분 이상 `processing` 으로 남은 job 은 다음 실행에서 자동으로 복구됩니다.                            |

모든 이벤트는 한 줄 JSON 으로 기록됩니다: `ingestion.started`, `exam.discovered`, `artifact.discovered`, `artifact.verified`, `artifact.published`, `artifact.changed`, `ingestion.failed`, `ingestion.completed` 등. URL query 와 secret 은 로그에서 제거됩니다.
알림: `OPS_WEBHOOK_URL`(https, Discord/Slack 호환)을 설정하면 source 구조 변경, 공개 시간대 종료 후 자료 미발견, job 영구 실패, 공식 자료 내용 변경, 검토 필요를 보냅니다. 없으면 구조화 로그만 남기고 앱은 정상 동작합니다.

### 영어 단어장 pipeline

영어 해설이 게시되면 다음 순서로 처리됩니다.

1. 해설 PDF 에서 텍스트를 추출하고 문항(18~45번)별로 나눕니다.
2. 원문에 실제로 있는 "영단어 + 한국어 뜻" 줄만 후보로 저장합니다. LLM 은 쓰지 않고 단어를 만들어내지 않습니다.
3. `[어휘]` 섹션 안의 항목은 신뢰도가 높아 자동 승인하고, 나머지는 `needs_review` 로 남겨 관리자가 검토합니다.
4. 승인된 단어로 우리가 만든 단어장 PDF 를 생성합니다 (Noto Sans KR, OFL). 이 PDF 는 `artifact_origin=generated` 로 공식 자료와 분리됩니다.

## 측정 결과 (로컬 production build, Lighthouse 12.8, 2026-09-24)

| 페이지                                      | Performance (mobile / desktop) | Accessibility | Best Practices | SEO   |
| ------------------------------------------- | ------------------------------ | ------------- | -------------- | ----- |
| `/`                                         | 98 / 100                       | 100           | 100            | 100   |
| `/exam/2025/high2/09`                       | 99 / 100                       | 100           | 100            | 100\* |
| `/exam/2025/high2/09/english`               | 95 / 100                       | 100           | 100            | 100\* |
| `/exam/2025/high3/07/social/social-culture` | 98 / 100                       | 100           | 100            | 100\* |

CLS 0.000, mobile LCP 1.9~2.6초 (Lighthouse 모바일 throttling 기준).
\* `ALLOW_SAMPLE_INDEXING=1`로 빌드한 경우입니다. 기본 빌드에서는 샘플 시험이 의도대로 noindex 라 SEO 66 으로 측정됩니다 (실제 데이터는 index).

## 배포

Next.js Node runtime 하나와 scheduler 하나면 됩니다 (별도 worker 서비스 불필요 — job 은 cron 호출 안에서 시간 예산 내 처리).

```bash
docker build -t mogo-storage --build-arg NEXT_PUBLIC_SITE_URL=https://<도메인> .
docker run --env-file .env.production mogo-storage npm run db:migrate:prod   # 배포마다 먼저 (idempotent)
docker run -d --env-file .env.production -p 3000:3000 mogo-storage          # HEALTHCHECK: /api/health
```

- production 에서 위험한 설정(https 아닌 `NEXT_PUBLIC_SITE_URL`, `INGESTION_ENABLED=true` 인데 `CRON_SECRET`/`DATABASE_URL` 없음, R2 설정 누락)이면 서버가 시작되지 않습니다. 관리자 미설정처럼 안전하게 꺼지는 기능은 경고만 남기고 `/admin` 은 404 입니다.
- scheduler: 위 "Scheduler 설정" 중 하나로 `/api/cron/scheduled` 를 5~10분마다 호출합니다 (`Authorization: Bearer CRON_SECRET`). 동시에 두 번 호출돼도 advisory lock 으로 한 번만 실행됩니다.
- Vercel 등 serverless 도 가능합니다 (`maxDuration=300`, 폰트 파일 tracing 포함). 단어장 PDF 생성은 Node runtime 이 필요합니다.
- R2: credential 을 넣은 뒤 `npm run storage:selftest` 로 업로드·읽기·서명 다운로드·한글 파일명을 확인합니다 (`_internal/test/` 사용 후 삭제).
- GitHub: `main` 에 PR checks(CI)를 required 로, force push 금지, 1명 이상 review 를 권장합니다.
- 백업/복구, 장애 대응: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## 코드 밖에서 남은 일

- 각 공식 source 의 실제 페이지를 capture → 사람 확인(expectedReviewed) → validate → 승인 (위 절차). 이 개발 환경에서는 네트워크 정책으로 공식 사이트 접근이 차단되어 아직 한 번도 실제 검증되지 않았습니다.
- source 별 이용조건(재배포 허용 여부) 법적 검토 → 확인된 source 만 `mirror_allowed`
- R2 bucket·credential 발급, 도메인 연결, `CRON_SECRET`·관리자 secret 발급, `OPS_WEBHOOK_URL` 설정
- 공식 등급컷·정답률은 공개 형식을 확인한 source 만 입력 (사교육 예상치는 이용조건 확인 전까지 수동 입력)
