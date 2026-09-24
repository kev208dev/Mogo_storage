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

| URL                            | 설명                                                    |
| ------------------------------ | ------------------------------------------------------- |
| `/exam/2025/high2/09`          | 시험 상세 (기본 과목: 국어, canonical)                  |
| `/exam/2025/high2/09/english`  | 과목별 페이지 (math, english, history, social, science) |
| `/grade/high2`, `/year/2025`   | 학년별 / 년도별 목록                                    |
| `/search?q=25 고2 9모`         | 자유 검색 → 해당 시험으로 redirect                      |
| `/api/files/[fileId]/download` | 다운로드 (스토리지 URL로 302)                           |
| `/api/files/[fileId]/view`     | 미리보기/재생 (inline)                                  |
| `/api/reports`                 | 오류 신고 (POST, Zod 검증)                              |

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

## 측정 결과 (로컬 production build, Lighthouse 13)

| 페이지                        | Performance | Accessibility | Best Practices | SEO  |
| ----------------------------- | ----------- | ------------- | -------------- | ---- |
| `/` (mobile / desktop)        | 99 / 100    | 100           | 100            | 100  |
| `/exam/2025/high2/09/english` | 97 / 100    | 100           | 100            | 100* |

\* `ALLOW_SAMPLE_INDEXING=1`로 빌드한 경우입니다. 이 설정이 없으면 샘플 페이지는 의도대로 noindex 처리됩니다.

## 향후 작업

- 실제 자료 업로드용 관리자 페이지 (파일 → R2, metadata → DB)
- 신고 관리 화면 (status: pending → reviewing → resolved/dismissed)
- 단어장 PDF 생성, PDF 페이지 뷰어와 해설 연동
- 다중 인스턴스 배포 시 Redis 등 공유 rate limiter
