# 공식 source 추가하기

새 공식 자료 출처(예: 다른 시·도 교육청)를 추가하는 절차입니다. **실제 페이지 fixture 로 검증하기 전에는 절대 자동 수집되지 않습니다.**

## 0. 먼저 확인

- 로그인·CAPTCHA·anti-bot 없이 공개된 공식 자료인가? 아니면 추가하지 않습니다 (우회 금지).
- robots.txt 가 해당 경로를 허용하는가?
- 이용조건: 재배포 허용이 문서로 확인되지 않으면 정책은 `source_redirect` (다운로드 시 공식 URL 로 연결).

## 1. 설정 (`src/ingestion/sources/config.ts`)

```ts
{
  id: "gyeonggi_office",
  kind: "education_office",          // 새 종류면 EXAM_SOURCE_KINDS + enum migration
  name: "경기도교육청",
  baseUrl: "https://...",
  allowedHosts: ["www.example.go.kr", "files.example.go.kr"],   // redirect 목적지까지 정확히
  deliveryPolicy: "source_redirect",
  enabled: false,
  liveVerified: false,
  capabilities: { ...NO_CAPABILITIES },
  minPollIntervalSeconds: 900, requestTimeoutMs: 20_000,
  maxConcurrentRequests: 1, minRequestGapMs: 3_000, maxRetries: 2,
}
```

시험 유형별 우선순위(`DEFAULT_SOURCE_PRIORITIES`)에 넣을 위치를 정합니다 (원본성 기준).

## 2. 페이지 저장 → 구조 파악

```bash
npm run ingest:capture -- --source=<id> --page-type=exam_list --url="<목록 URL>"
npm run ingest:capture -- --source=<id> --page-type=exam_detail --url="<시험 페이지>" --exam-title="<시험명>"
```

저장된 `tests/fixtures/live/<dir>/*.html` 을 보고 구조를 파악합니다. 추측으로 selector 를 만들지 않습니다.

## 3. adapter 구현

- 게시판형이면 `BoardSourceDefinition`(`src/ingestion/sources/board`)에 `structure.ts` 만 추가해 재사용합니다.
- 아니면 `ExamSourceAdapter` 를 구현합니다. 구조 가정(selector/URL)은 source 폴더의 `structure.ts` 한 곳에만 둡니다.

```ts
interface ExamSourceAdapter {
  discoverExams(options): Promise<DiscoveredExam[]>; // 시험 목록 (자료 URL 을 보지 않음)
  discoverArtifacts(exam): Promise<DiscoveredArtifact[]>; // 한 시험의 문제/정답/해설/음원/대본
  discoverReleaseTimes?(exam): Promise<DiscoveredReleaseTime[]>; // 공식 공개 시각 (있으면)
  healthCheck(): Promise<SourceHealth>;
}
```

- parser 는 순수 함수(HTML → 결과)로 두고 네트워크·DB 를 모르게 합니다.
- 분류는 반드시 `classifyArtifact` 를 사용합니다 (영역·세부과목·종류 규칙 공통, source 원문 표기 보존).
- 구조가 다르면 조용히 빈 결과를 내지 말고 `SourceStructureChangedError` 를 던집니다.
- 모든 요청은 주입된 `Fetcher`(SafeFetcher)로만 합니다.
- `createAdapter`(`registry.ts`)와 `PARSER_VERSION_FILES`(`parser-version-files.ts`)에 등록합니다.

## 4. 테스트

- parser 단위 테스트 (fixture 기반, 네트워크 없음)
- `validateFixture` contract 통과 (`runParser` 의 pageType 분기에 새 source 가 필요하면 추가)
- `npm run ingest:parser-version` → `npm test`

## 5. 검증 · 활성화

```bash
# .json 의 expected 요약을 실제 페이지와 대조 → expectedReviewed: true
npm run ingest:fixtures:validate
npm run ingest:fixtures:validate -- --record          # 증거 기록 (DATABASE_URL)
```

`/admin` → [검증 승인] → [health check] → [켜기] → `시험 목록`(discovery) → `자료 수집`(artifacts) → `시험일 감시`(release_watch).

## 6. 과거 자료 (canary)

```bash
npm run ingest:backfill -- --source=<id> --from=<올해-1> --to=<올해> --metadata-only
npm run ingest:audit -- --source=<id> --from=<올해-1> --to=<올해> --record
npm run ingest:backfill -- --source=<id> --from=<올해-3> --to=<올해>
npm run ingest:audit -- --source=<id> --from=<올해-3> --to=<올해> --record
npm run ingest:backfill -- --source=<id> --from=<source 의 가장 오래된 연도> --to=<올해>
```
