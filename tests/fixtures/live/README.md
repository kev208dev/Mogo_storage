# Live source fixtures

`npm run ingest:capture` 로 저장한 **실제 공개 페이지** fixture 가 들어갑니다 (source 별 하위 디렉터리).
아직 실제 페이지를 확보하지 못해 비어 있습니다. 비어 있는 동안 모든 source 는 "실제 구조 미검증" 이며 자동 수집되지 않습니다.

각 fixture 는 `<name>.html` + `<name>.json`(source, pageType, url, capturedAt, sha256, parserVersion, examIdentity,
context, expected, expectedReviewed)입니다. `expectedReviewed=false` 인 fixture 는 CI 검증은 받지만 승인 증거로는 쓰이지 않습니다.
