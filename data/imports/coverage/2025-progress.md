# 2025 official material coverage audit — in progress

This is an intermediate audit. The 2025 course and file-type inventory is not complete, and no new candidate has been imported or published. Do not use the counts here as a completeness percentage.

## Sources and baseline

- [EBSi exam schedule and subject scope](https://www.ebsi.co.kr/ebs/ent/enta/retrieveExmSchedRng.ebs), checked against actual EBSi PDFs.
- [Government notice moving the June exam to 4 June](https://www.korea.kr/multi/visualNewsView.do?newsId=148941577).
- [School notice confirming the high3 May exam on 8 May](https://www.goegy.kr/gmsh-h/na/ntt/selectNttInfo.do?bbsId=843&mi=2419&nttSn=1116436).
- Original CSV: 309 rows overall, including 100 for 2025 (89 approved and 11 held per the existing verification file). These figures describe discovered candidates, not expected coverage.
- Public site crawl: 15 exam pages, 316 reachable exam/course pages, and 92 distinct 2025 file IDs. Duplicate appearances of one file on exam and subject pages were counted once. The public count is a page-derived baseline, not a DB query.
- Production-connected Supabase MCP returned `Unauthorized`; no local `DATABASE_URL` is available. Live DB counts and approval semantics cannot yet be verified.

## Findings

- All 15 scheduled 2025 exam dates are recorded in [2025-inventory.json](2025-inventory.json). It distinguishes school exams, KICE mock exams, and CSAT.
- EBSi's high3 3/5/7 monthly summary omits Korean history, but its own PDF files confirm actual Korean-history questions or solutions for all three exams. The exam-specific PDFs take precedence over the summary label.
- The 2025 high3 May exam occurred on 8 May. The EBSi file directory `20250430` is not the exam date.
- The provisional [full-year slot matrix](2025-expected-slots.csv) has 669 rows: 178 document/public-confirmed, 435 based on EBSi subject-scope tables awaiting exam-specific confirmation, and 56 with official availability or grade-model uncertainty. Its missing count is **not** a final completeness number. The high3 May [exam-specific matrix](2025-high3-05.csv) currently has 45 question/solution slots. None is public, 37 have newly verified EBSi URLs awaiting import, and eight remain without a safely verified official URL. English listening availability is still under investigation and is outside this 45-slot count.
- Across 2025, 69 new official URL rows have been appended. Each has an EBSi PDF content/identity record in the existing evidence and verification JSON. They are recorded as `verified_pending_import` and `not_imported`, not as approved or public.

- Six published high3 Korean/math question files are subject-wide while the provisional choice-course layout expects course-specific files. Their bundle coverage needs document-level confirmation before counting those course slots ready.
- The provisional matrix flags 26 high2 October vocational/second-language slots as potential model blockers: EBSi scope lists them, while the catalog restricts those courses to high3. Actual file availability and a safe catalog change still require confirmation.

## High3 May remaining slots

| Subject | Course | Type | Reason |
| --- | --- | --- | --- |
| Science | life-science-1 | question | official_url_not_found |
| Science | life-science-2 | question | official_url_not_found |
| Social | east-asian-history | solution | official_url_not_found |
| Social | economics | solution | official_url_not_found |
| Social | ethics-and-thought | question | official_url_not_found |
| Social | korean-geography | question | official_url_not_found |
| Social | social-culture | question | official_url_not_found |
| Social | social-culture | solution | official_url_not_found |

## Next audit steps

1. Resolve the 435 scope-provisional and 56 uncertain matrix rows against actual exam-specific material, especially listening, high2 October vocational/second-language, and choice-course bundle layouts; continue official URL discovery for every confirmed missing slot.
2. Recheck the 11 held 2025 PDFs with official listing or internal document evidence; retain holds where identity remains unproven.
3. Record live DB baseline, import new rows into `manual_review`, approve only through the existing business semantics, and recrawl the public pages and redirects.
4. Complete 2024 and 2023 audits before starting the 2022 backfill.
