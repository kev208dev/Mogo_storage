# 시험 일정 (exam_schedules)

공식 발표(교육청·평가원 시행 계획 공지 등)로 **확인된 일정만** 등록합니다.
추측한 날짜나 검색엔진용 가짜 일정은 넣지 않습니다.

```bash
npm run ingest:schedules -- --file=data/schedules/2027.json --dry-run   # 바뀌는 내용만 출력
npm run ingest:schedules -- --file=data/schedules/2027.json
```

학원·언론 기사에 나온 날짜는 근거로 쓰지 않습니다. 같은 학년·월에 다른 시험 유형 일정이 있으면 거부합니다.
운영 DB 반영은 GitHub Actions `Exam schedules` workflow(수동 실행, dry-run 기본)로도 할 수 있습니다.

형식 (`template.json` 참고):

| 필드                           | 설명                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `year`, `grade`, `month`       | 시행 연도(달력 기준)·학년·월 — 사이트 URL 과 같은 기준                           |
| `examType`                     | `school_mock` (전국연합학력평가) / `kice_mock` (평가원 모의평가) / `csat` (수능) |
| `examDate`                     | 시행일 `YYYY-MM-DD`                                                              |
| `expectedReleaseStart/End`     | (선택) 자료 공개 감시 시간대. 없으면 시험일 12:00 ~ 다음 날 23:59 KST            |
| `announcementUrl`              | (필수) 일정 근거가 되는 공식 공지 URL — https, 평가원·교육부·교육청(`*.go.kr`)만 |
| `changeNote`                   | (선택) 시행일 변경 사유 — 이전 날짜는 `previous_exam_date` 로 보존               |
| `cancelled`, `cancelledReason` | (선택) 공식 공지로 확인된 시험 취소                                              |

등록하면 시험 페이지(`/exam/2027/high2/03` 등)가 "시험 예정" 상태로 먼저 생성되고,
시험 당일에는 release watch 가 자료 공개를 감시합니다.
