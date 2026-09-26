# 운영 런북 (OPERATIONS)

정상 상태에서는 시험마다 운영자가 할 일이 없습니다. 이 문서는 **정상이 아닐 때** 보는 문서입니다.

## 매일 / 시험일 확인 순서

1. `/admin` — source 상태, 오늘 자료 표, 실패 목록, 검토 대기, 오류 신고
2. 운영 알림 채널 (`OPS_WEBHOOK_URL`) — 구조 변경, 공개 후 미발견, job 영구 실패, 내용 변경
3. 필요하면 CLI (DB 접근 가능한 곳에서)

```bash
npm run ingest:coverage -- --from=2025 --to=2026      # 시험·영역·세부과목별 ✓/✗/검토
npm run ingest:coverage -- --features --year=2025     # 시험별 기능 상태 (파일·정답·등급컷·듣기·단어장), /admin/coverage 와 같은 계산
npm run ingest:audit -- --json                        # 중복·URL·도메인·누락·미확정·공개 후 미발견
npm run ingest:health -- --source=ebsi                # 실제 사이트 요청 1회 (결과는 DB 에 기록)
npm run ingest:inspect -- --source=ebsi --year=2026 --grade=3 --month=9   # 읽기 전용 진단
```

`GET /api/health` 는 `{app, database}` 만 알려줍니다 (uptime monitor 용). source 상세는 `/admin` 에서만 봅니다.

## 상황별 대응

### EBSi parser 가 깨짐 (`structure_changed`, 알림 "source 구조 변경 의심")

자동 게시는 이미 멈춘 상태입니다 (구조 변경 상태의 source 는 어떤 기능도 실행되지 않음). 잘못된 자료가 게시되지 않습니다.

1. `/admin/runs` 오류 메시지 확인 (`SOURCE_STRUCTURE_CHANGED: list container ... not found` 등)
2. 네트워크 가능한 환경에서 새 페이지 저장: `npm run ingest:capture -- --source=ebsi --page-type=exam_list --grade=3 --year=2026`
3. `src/ingestion/sources/ebsi/structure.ts`(selector/URL)와 parser 수정 → `npm run ingest:parser-version`
4. 저장된 `.json` 의 expected 를 실제 페이지와 대조 → `expectedReviewed: true`
5. `npm run ingest:fixtures:validate` 통과 → 배포 → `npm run ingest:fixtures:validate -- --record`
6. `/admin`: [검증 승인] → [health check] → [켜기] → 기능 단계별 켜기
7. 놓친 기간 보충: `npm run ingest:backfill -- --source=ebsi --from=2026 --to=2026`

### KICE 접속 불가 (`network_error`, timeout/5xx/429/403)

- 일시 장애는 자동 재시도됩니다 (job 지수 backoff, discovery 는 다음 주기). 조치 불필요.
- 평가원 시험은 우선순위가 KICE → EBSi 이므로 EBSi 가 켜져 있으면 EBSi 자료가 먼저 게시되고, KICE 복구 후 같은 슬롯이 KICE 자료로 교체됩니다.
- 403 이 계속되면 접근 차단입니다. **우회하지 않습니다.** source 를 끄고 기관에 문의합니다.

### 시험 당일 자료가 발견되지 않음 (알림 "공개 시간대 종료 후 자료 미발견")

1. 공식 사이트에 실제로 올라왔는지 브라우저로 확인
2. 올라왔는데 못 찾음 → 구조 변경 가능성: `npm run ingest:inspect -- --source=kice --year=2026 --grade=3 --month=9`
3. 공식 공개가 늦어진 경우 → 정기 수집(6시간 주기)이 이어서 확인합니다. 급하면 `/admin` [지금 수집]
4. 공개 시각 표가 있는 시험(KICE)은 일정 파일의 `sourcePages` 에 index URL 을 등록해 두면 공식 시각에 맞춰 확인합니다.

### job 이 멈춤 / 계속 실패

- `processing` 에 15분 이상 남은 job 은 다음 실행에서 자동 복구됩니다.
- `failed`(maxAttempts 초과) 는 `/admin` 실패 목록에서 원인 확인 → [다시 시도] 또는 [무시](`dismissed`).
- 수동 처리: `npm run ingest:jobs`

### DB migration 실패

- migration 은 한 transaction 으로 적용되므로 실패하면 전체가 롤백됩니다. 원인(권한, 잠금, 디스크) 해결 후 `npm run db:migrate:prod` 재실행.
- 배포 순서: **백업 → migration → 앱 배포**. 새 코드가 새 컬럼을 필요로 하므로 migration 이 먼저입니다. 모든 migration 은 additive(컬럼·테이블·enum 값 추가)라 이전 버전 앱과 함께 잠시 동작해도 안전합니다.
- 되돌려야 하면 아래 "복구"로 백업에서 복원합니다 (down migration 은 두지 않음).

### R2 장애

- `source_redirect` 자료(기본)는 R2 를 쓰지 않으므로 영향이 없습니다.
- R2 에 저장된 자료(`mirror_allowed`, 생성 단어장)는 다운로드 시 502 안내 페이지가 나옵니다. 사이트 나머지는 정상.
- 복구 확인: `npm run storage:selftest`

### 잘못된 파일이 게시됨

1. `/admin/review` 또는 DB 에서 해당 `source_artifacts` 확인 (sourceUrl, finalUrl, source_label)
2. 잘못된 시험에 연결 → `/admin/mappings` 에서 올바른 시험으로 이동(고정)
3. 잘못된 과목 → 검토 화면에서 과목 지정 (alias 저장으로 재발 방지)
4. 파일 자체가 잘못됨 → 해당 artifact [거절]. 수동 교체 파일이 필요하면 `exam_files` 에 `source_artifact_id = NULL` 로 등록하면 자동 수집이 덮어쓰지 않습니다.
5. 오류 신고가 있으면 `/admin/reports` 에서 상태 변경

### 공식 자료 내용이 바뀜 (알림 "공식 자료 내용 변경")

같은 URL 의 내용이 바뀌면 `artifact.changed` 로 기록하고 재검증 후 재게시합니다 (정오표 반영 등). 원본 이상 여부만 확인하면 됩니다.

## 백업 / 복구 (PostgreSQL 일반 방법)

```bash
# 백업 (매일 + migration 직전). custom format 은 선택 복원이 가능하다
pg_dump --format=custom --no-owner --file=mogo-$(date +%F).dump "$DATABASE_URL"

# 복구 (새 DB 에)
createdb mogo_restore
pg_restore --no-owner --dbname=postgres://.../mogo_restore mogo-2026-09-24.dump
DATABASE_URL=postgres://.../mogo_restore npm run db:migrate:prod     # 백업 이후 migration 적용
DATABASE_URL=postgres://.../mogo_restore npm run ops:restore-verify  # migration 수·행 수·공식 URL·샘플 섞임 점검 (읽기 전용)
DATABASE_URL=postgres://.../mogo_restore npm run ingest:audit        # 슬롯 무결성 확인
```

- `ops:restore-verify -- --min-exams=<N> --min-files=<N>` 로 복원 전 운영 규모를 기준으로 줄 수 있습니다. 하나라도 실패하면 exit 1 입니다.
- Supabase 는 대시보드의 Backups/PITR 로 복원합니다. 복원한 DB 로 바로 서비스를 전환하지 말고 위 세 명령을 먼저 실행합니다.

- 관리형 PostgreSQL 은 PITR(시점 복구)을 켜 두는 것을 권장합니다.
- R2 에는 원본 대신 재생성 가능한 자료가 대부분입니다. 단어장 PDF 는 job 으로 다시 만들 수 있고(`generate_vocabulary_pdf`), `source_redirect` 자료는 R2 에 없습니다.
- 복원 후 `npm run ingest:coverage` 로 누락을 확인하고 필요하면 backfill 로 보충합니다 (idempotent).

## Scheduler 감시 (heartbeat · watchdog)

- 모든 `/api/cron/<task>` 실행은 `scheduler_heartbeats` 에 시작·종료·결과(`ok`/`skipped`/`failed` + 짧은 상태 코드)를 남깁니다. 기록이 실패해도 cron 자체는 영향을 받지 않습니다.
- `/api/cron/watchdog` 이 기대 주기 대비 늦은 task(`stale`), 연속 실패(`failing`), 켜져 있는데 기록이 없는 task(`never_run`)를 찾아 `OPS_WEBHOOK_URL` 로 알립니다. 정상으로 돌아오면 복구 알림을 한 번 보냅니다.

| task         | 기대 주기 | stale 기준 | 감시 조건                          |
| ------------ | --------- | ---------- | ---------------------------------- |
| `grade-cuts` | 5분       | 45분       | `GRADE_CUT_INGESTION_ENABLED=true` |
| `scheduled`  | 10분      | 90분       | `INGESTION_ENABLED=true`           |
| `watchdog`   | 1시간     | 36시간     | 항상 (관리자 화면 표시용)          |

- 기준은 `SCHEDULER_STALE_MINUTES_GRADE_CUTS=60` 처럼 env 로 조정합니다 (주기보다 짧은 값은 무시).
- watchdog 은 두 곳에서 호출합니다. 한쪽 scheduler 가 멈춰도 다른 쪽이 감지합니다.
  - GitHub Actions `Scheduler watchdog` (매시): `/api/health` 확인 + watchdog 호출. 이상이 있으면 workflow 가 실패로 표시됩니다. health 실패는 직전 실행이 성공이었을 때만 webhook 을 보냅니다 (secret `OPS_WEBHOOK_URL`, 선택).
  - Vercel Cron (`vercel.json`, 매일): 같은 watchdog 호출. GitHub schedule 자체가 멈춘 경우를 잡습니다.
- 확인: `/admin` 대시보드의 "Scheduler 상태", 또는 `npm run ops:scheduler` (`--json`, `--strict`, 알림까지 보내려면 `--watchdog`).
- 공개 `/api/health` 는 `app`, `database` 만 돌려줍니다. cron·source 상태는 관리자 화면과 인증된 watchdog 응답에만 있습니다.

### "scheduler 지연" 알림을 받았을 때

1. GitHub Actions 의 `Grade cut watch` / `Scheduled ingestion` 실행 기록을 봅니다. schedule 이 멈췄으면 `workflow_dispatch` 로 한 번 실행하고, 저장소가 60일 이상 비활성이면 workflow 를 다시 켭니다.
2. 실행은 되는데 heartbeat 가 없으면 `/api/cron/<task>` 응답(401/404/5xx)을 확인합니다. `CRON_SECRET`·`INGESTION_SITE_URL` secret 을 점검합니다.
3. "연속 실패"면 `/admin` 의 상태 코드(예: `advisory_lock`)와 Vercel 로그의 `grade_cut_watch.failed` 를 봅니다.

## 운영 알림 중복 방지

- webhook 알림은 문제 단위 key(예: `scheduler:grade-cuts`, `source_broken:ebsi`, `job_dead:<type>`)로 묶어 cooldown(기본 6시간, `OPS_ALERT_COOLDOWN_MINUTES`) 동안 한 번만 보냅니다. 생략한 횟수는 다음 알림에 덧붙입니다.
- 상태는 `ops_alert_states` 에 있습니다. 여러 인스턴스가 동시에 보내도 row lock 으로 한 번만 발송됩니다. 이 테이블을 읽지 못하면 알림을 막지 않고 보냅니다 (누락보다 중복이 낫다).
- 로그(`ops.alert_suppressed`)에는 생략 사실만 남습니다.

## Production smoke test

```bash
SMOKE_BASE_URL=https://mogo-storage.vercel.app npm run test:smoke:prod
```

- 읽기 전용입니다. 대상은 sitemap 에서 고르므로 데이터가 늘어도 그대로 동작합니다.
- 확인 항목: 홈·검색·최신/legacy 시험·고1/2/3·국어 canonical redirect·수학/영어·사회/과학 세부과목·enum 경로 308·404·다운로드 302(공식 도메인, 따라가지 않음)·"자료 준비 중"·`/api/health`·admin/cron/revalidate 비인증 차단·robots·sitemap.
- GitHub Actions `Production smoke` 가 매일 실행합니다 (수동 실행 시 `base_url` 입력 가능). 다운로드 허용 호스트를 늘리려면 `SMOKE_ALLOWED_DOWNLOAD_HOSTS` 를 씁니다.

## 환경변수 검증

- 서버 시작 시(`instrumentation`)와 Vercel Production build 시(`next.config.ts`) 같은 검증을 합니다. build 에서 실패하면 배포가 중단되고 기존 배포가 계속 서비스됩니다.
- 실패 조건: `NEXT_PUBLIC_SITE_URL` 이 https origin 이 아님(경로·쿼리·계정정보 포함) · 수집/등급컷 cron 이 켜졌는데 DB 나 16자 이상 `CRON_SECRET` 없음 · 관리자 설정 3개 중 일부만 있음 또는 짧음 · DB 연결 상태에서 `ALLOW_SAMPLE_INDEXING=1` · R2 설정 일부만 있음/`R2_PUBLIC_BASE_URL` 이 https 아님.
- 메시지에는 변수 이름만 나오고 값은 출력하지 않습니다. 긴급 우회는 `SKIP_ENV_VALIDATION=1` (원인을 고친 뒤 제거).

## 보안 점검

- secret 은 환경변수로만 주입합니다. 로그는 URL query 와 secret 키를 제거합니다 (`sanitizeFields`).
- `/admin` 은 allowlist + 토큰 + 서명 세션(httpOnly, SameSite=Strict, production Secure, 12시간)이며 설정이 없으면 404.
- cron endpoint 는 `CRON_SECRET` 이 없으면 404, 틀리면 401 (timing-safe 비교).
- 외부 요청은 SafeFetcher 만 사용: https/allowlist, redirect 마다 재검증, private IP·localhost·metadata 주소 차단, timeout, 크기 제한, robots.txt.

## 기능 coverage (`src/ingestion/feature-coverage.ts`)

| 상태             | 의미                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| `complete`       | 필요한 슬롯이 모두 채워짐                                                        |
| `partial`        | 일부만                                                                           |
| `manual_review`  | 사람이 확인해야 하는 대기 건 (검토 대기 자료, 정답표 보류)                       |
| `missing`        | 자동화 가능하지만 아직 없음                                                      |
| `blocked_policy` | 없음 + 정책상 자동 수집 불가 (예: 해설이 KICE 에만 있음, 고3 국어 원점수 등급컷) |
| `not_applicable` | 해당 없음 (영어가 없는 시험의 듣기 등)                                           |

- 슬롯 = 세부과목이 있으면 세부과목, 없으면 영역 전체. 등급컷은 상대평가 슬롯만 셉니다.
- 쿼리는 시험 목록 1회 + 테이블별 group by 1회 (시험 수와 무관, N+1 없음). 관리자 화면은 50개씩 페이지로 나눕니다.
- 인덱스: 모든 집계 쿼리는 `exam_id` 로 시작하는 기존 인덱스를 씁니다 (추가 migration 없음).
