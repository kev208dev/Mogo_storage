# 영어 학습 자료 · 생성 자료 검토 · 시험 일정

## 출처(provenance) 원칙

| 자료                    | 출처                                                   | 공개 조건                                                     |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| 문제·해설·음원·대본 PDF | 공식 원본 (`exam_files.artifact_origin = official`)    | 기존 수집·검증·게시 흐름                                      |
| 문항별 대본             | 공식 듣기 대본 PDF → `listening-script-v1` parser      | `listening_transcripts.origin` 이 official/authorized 일 때만 |
| 문항 구간 재생          | `listening_tracks.timing_verified = true` 인 트랙만    | 미검증이면 전체 음원 재생만 (구간 추측 금지)                  |
| 단어장                  | 공식 해설 PDF 에서 규칙 추출 (`vocabulary.provenance`) | 자동 승인 기준 · 후보 검토                                    |
| 학습지 PDF              | 모의고사 창고 생성 (`study_materials`)                 | 관리자 승인 → 게시 (`artifact_origin = generated`)            |
| 독해 노트               | 운영자 작성 / AI 보조 (`origin = ai_assisted`)         | 관리자 승인 → 게시, 지문 전문 금지                            |

AI 가 음원을 듣고 만든 대본, 추측한 문항 구간, 출처가 확인되지 않은 지문 전문은 저장·공개하지 않는다.

## 처리 흐름

1. 영어 `listening_script`/`listening_audio` 게시 → `extract_listening_script` job (운영자 입력 URL 은 서버가 요청하지 않으므로 제외)
2. 대본 문항 번호가 1번부터 연속되지 않으면 공개하지 않고 job 실패로 남는다 (관리자 jobs 화면)
3. 단어장 · 대본 · 웹 정답이 바뀌면 `generate_study_materials` job → `study_materials(status=generated)`
4. `/admin/study` 에서 검토 시작 → 승인 → 게시. 게시를 내리면 우리가 만든 파일만 삭제된다
5. 상태가 바뀌면 해당 시험 영어 페이지만 revalidate 한다

기존 `generate_vocabulary_pdf` job 은 호환용으로 남아 학습지 생성으로 처리되며, 더 이상 바로 게시하지 않는다.

### 브라우저 승인 공식 파일의 후처리

EBSi archive 목록처럼 robots 정책상 자동 discovery 할 수 없는 source 는 `operator_import` 로만 등록한다.
다만 운영자가 브라우저에서 파일 본문까지 확인해 `verification_mode=operator_browser`, `status=ready` 로
게시한 **직접 공식 파일 URL**은 discovery 와 분리된 후처리 배치에서 읽을 수 있다.

```bash
npm run english:enrich -- --year=2026 --grade=3 --month=9 --dry-run
npm run english:enrich -- --exam=exam_2026_h3_09
```

이 배치는 다음 조건을 모두 만족할 때만 요청한다.

- 이미 `exam_files.artifact_origin=official` 로 게시된 redirect 자료
- 연결된 `source_artifacts` 가 ready + verified 상태
- `operator_import` 이면 반드시 `verification_mode=operator_browser`
- 게시 URL이 검증 당시 `source_url` 또는 `final_url` 과 동일
- 정책상 파일 요청이 허용된 좁은 allowlist(현재 `wdown.ebsi.co.kr`) 안의 URL

따라서 EBSi `.ajax` archive, 로그인, CAPTCHA, anti-bot 경로를 요청하거나 우회하지 않는다.
해설 PDF 에서는 규칙 기반 단어 후보만 추출하고, 공식 듣기 대본+음원이 함께 게시된 시험만 대본을
문항별로 연결한다. 음원 구간은 계속 미검증으로 두며 추측하지 않는다. 생성 학습지는 별도
`--enqueue-materials` 옵션으로만 예약하고 관리자 승인 전에는 공개하지 않는다.

## 독해 노트 입력

`data/study/README.md` 참고. `npm run study:import-notes -- --file=… --dry-run`.

## 시험 일정

`data/schedules/README.md` 참고. 공식 공지 URL(https, 평가원·교육부·교육청 `*.go.kr`)이 없는 일정은 받지 않는다.
날짜 변경은 이전 날짜(`previous_exam_date`)와 사유를 남기고, 취소는 `exams.exam_date` 를 비워 시험일 기준
자동 작업(release watch · 등급컷 감시)이 시작되지 않게 한다. `/admin/schedules` 에서 확인한다.
운영 반영: GitHub Actions `Exam schedules` (수동 실행, 기본 dry-run, `INGESTION_DATABASE_URL` secret 필요).

## 공식 등급컷

시행 기관은 원점수 등급컷을 공개하지 않는다 (평가원은 채점 결과의 표준점수 등급 구분점수만, 교육청 학평 결과
파일은 자동 수집 불가 경로). 기계로 검증 가능한 공식 원점수 경계가 없으므로 공식 원점수 등급컷 adapter 는 두지
않고, 화면에 "공식 원점수 등급컷 미제공"을 표시한다. 다른 기관 값으로 공식 값을 만들지 않는다.
