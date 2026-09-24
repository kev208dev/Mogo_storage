# 시험 일정 (exam_schedules)

공식 발표(교육청·평가원 시행 계획 공지 등)로 **확인된 일정만** 등록합니다.
추측한 날짜나 검색엔진용 가짜 일정은 넣지 않습니다.

```bash
npm run ingest:schedules -- --file=data/schedules/2027.json
```

형식 (`template.json` 참고):

| 필드 | 설명 |
| --- | --- |
| `year`, `grade`, `month` | 시행 연도(달력 기준)·학년·월 — 사이트 URL 과 같은 기준 |
| `examType` | `school_mock` (전국연합학력평가) / `kice_mock` (평가원 모의평가) / `csat` (수능) |
| `examDate` | 시행일 `YYYY-MM-DD` |
| `expectedReleaseStart/End` | (선택) 자료 공개 감시 시간대. 없으면 시험일 12:00 ~ 다음 날 23:59 KST |
| `announcementUrl` | (권장) 일정 근거가 되는 공식 공지 URL |

등록하면 시험 페이지(`/exam/2027/high2/03` 등)가 "시험 예정" 상태로 먼저 생성되고,
시험 당일에는 release watch 가 자료 공개를 감시합니다.
