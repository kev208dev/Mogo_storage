# Source fixtures

⚠️ **이 디렉터리의 HTML 은 합성(synthetic) fixture 입니다.** 실제 EBSi / 평가원 / 교육청 페이지를
저장한 것이 아니라, 각 adapter 의 `structure.ts` 가 가정하는 구조를 재현한 것입니다.
(개발 환경에서 해당 사이트 접근이 차단되어 실제 HTML 을 확보하지 못했습니다.)

- 링크된 PDF/MP3 URL 은 실제 파일을 가리키지 않으며, 테스트에서는 placeholder 파일로 응답합니다.
- 실제 시험지/해설지/음원은 이 저장소에 포함하지 않습니다.

## 실제 페이지 fixture (live)

실제 공개 페이지는 `tests/fixtures/live/<source>/` 에 저장합니다 (현재 없음).

1. 네트워크가 허용된 환경에서 `npm run ingest:capture -- --source=ebsi --url="..." --grade=3 --year=2025`
   → sanitize 된 HTML 과 metadata(json)가 저장되고, 현재 parser 로 바로 contract 검사를 합니다.
2. `npm run ingest:fixtures:validate` 로 모든 live fixture 를 parser 에 통과 (CI 에서도 실행)
3. 실패하면 `src/ingestion/sources/<source>/structure.ts` 를 수정 → `npm run ingest:parser-version`
4. 통과하면 `npm run ingest:fixtures:validate -- --record` → `/admin` 에서 검증 승인
