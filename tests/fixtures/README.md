# Source fixtures

⚠️ **이 디렉터리의 HTML 은 합성(synthetic) fixture 입니다.** 실제 EBSi / 평가원 / 교육청 페이지를
저장한 것이 아니라, 각 adapter 의 `structure.ts` 가 가정하는 구조를 재현한 것입니다.
(개발 환경에서 해당 사이트 접근이 차단되어 실제 HTML 을 확보하지 못했습니다.)

- 링크된 PDF/MP3 URL 은 실제 파일을 가리키지 않으며, 테스트에서는 placeholder 파일로 응답합니다.
- 실제 시험지/해설지/음원은 이 저장소에 포함하지 않습니다.

## 실제 구조로 갱신하는 방법

1. 네트워크가 허용된 환경에서 `npm run ingest:fixtures -- --source=ebsi` 실행
   → `tests/fixtures/<source>/live-*.html` 로 실제 목록 페이지가 저장됩니다. (시험 파일은 받지 않음)
2. `src/ingestion/sources/<source>/structure.ts` 의 selector/URL 을 실제 구조에 맞게 수정
3. parser 테스트가 실제 fixture 로 통과하도록 갱신하고 `verifiedAgainstLivePage: true` 로 변경
4. `npm run ingest:health` 로 live 확인 후 운영에서 source 를 enable
