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
- The provisional [full-year slot matrix](2025-expected-slots.csv) now has 704 rows after adding 35 catalog-confirmed high3 Korean/math course-solution slots: 675 document/public-confirmed, four based on earlier scope tables awaiting reconciliation, and 25 with official availability uncertainty. Its remaining missing rows are listening or legacy subject-level aliases, not unlocated canonical question/solution PDFs. The earlier high3 May [exam-specific matrix](2025-high3-05.csv) remains a historical 45-slot snapshot; the official catalog establishes 48 canonical course-level question/solution slots for that exam.
- All 11 previously held 2025 PDFs were rechecked page by page. None contains sufficient exam year/month/grade identity; all remain held.
- Across 2025, 575 new candidate rows (563 new URLs and 12 course mappings to existing official bundles) have been appended. Each has an EBSi PDF content/identity record in the existing evidence and verification JSON. They are recorded as `verified_pending_import` and `not_imported`, not as approved or public.

- Five published high3 Korean/math question bundles were checked by full PDF text and rendered page headers. They cover 12 choice-course slots, now recorded as candidates pending import; the original subject-wide rows remain intact. For high3 June, the broken subject-wide KICE math URL remains recorded as `dead_link`, while three separately indexed EBSi PDFs now verify the probability-and-statistics, calculus, and geometry question slots. See [bundle evidence](2025-bundle-evidence.json) for the earlier bundles and the verification JSON for June.
- The high3 June English question PDF and official listening script were also verified from indexed EBSi URLs. The public KICE question redirect remains broken until publication semantics can be applied with DB access; the script is a newly identified candidate. No official listening-audio URL has yet been verified.
- Indexed official listening-script PDFs were additionally verified for high1 March and June, high2 March, and high3 March. Each rendered cover states its year, month, grade, subject, and document type. The remaining script and every listening-audio slot stay unresolved unless an indexed official URL is found.
- High2 June science coverage now includes verified question and solution PDFs for physics I, chemistry I, life science I, and earth science I. All eight rendered first pages state the 2025 June high2 exam, course, and document type.
- Seven high2 June social-studies gaps were also verified: life and ethics question/solution, ethics and thought question, world geography question/solution, East Asian history question, and world history solution. Existing slots were checked before append; an already present Korean-geography solution was not duplicated.
- EBSi's official previous-paper catalog endpoint exposed the remaining high2 June paths that were absent from search indexes. The English and math questions plus seven social-studies question/solution gaps were downloaded and visually verified. All 34 modeled high2 June question/solution slots now have an official PDF: 27 await import and seven were already public.
- The same catalog pass recovered all 16 missing high1 question/solution PDFs across March, June, September, and October. Every rendered first page matched the cataloged year, month, grade, subject, and document type; all 48 modeled high1 question/solution slots now have an official PDF.
- The catalog pass also recovered 79 missing high2 question/solution PDFs across March, September, and October.
- High3 March and May gained 48 verified candidate rows from the catalog. Ten course-level Korean/math solution slots missing from the original matrix were added. The official catalog's canonical coverage is now complete for all 40 March and all 48 May question/solution slots; broader subject-level legacy aliases remain only for traceability.
- High3 June and September gained another 110 verified candidate rows and ten newly modeled course-level solutions. Canonical official coverage is now complete for all 78 question/solution slots in each KICE mock exam; remaining subject-level legacy aliases are retained for traceability.
- High3 July, October, and the November CSAT gained 182 verified candidate rows and 15 newly modeled course-level solutions. Canonical official coverage is complete for all 48 July, 74 October, and 78 CSAT question/solution slots; CSAT odd-form PDFs are used for canonical Korean, math, English, and history questions while even-form alternates are excluded.
- The 26 high2 October vocational/second-language question/solution PDFs were downloaded and visually verified. The course regime now permits these official high2 materials, with focused regression coverage preserving the existing high3 behavior.

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

1. Resolve the four scope-provisional and 25 listening-availability rows, and reconcile legacy subject-level aliases without deleting existing approved artifacts.
2. Seek independent official listing or bundle evidence for the 11 still-held 2025 PDFs; retain holds where identity remains unproven.
3. Record live DB baseline, import new rows into `manual_review`, approve only through the existing business semantics, and recrawl the public pages and redirects.
4. Complete 2024 and 2023 audits before starting the 2022 backfill.

## Public source health correction

All 92 public download actions returned 302. HEAD requests to their observed official destinations returned 200 PDF for 88 EBSi files and 404 for four KICE files: high3 June math question/solution and English question/solution. The matrix now counts those four as `missing` / `dead_link`, preserving their published file IDs for traceability. Published presence does not establish usable coverage. See [redirect/source baseline](2025-public-baseline.json). These are HTTP checks, not fresh content verification of all 88 PDFs.

Current provisional status totals: public_ready 88, manual_review 586, missing 30, model_blocked 0. Of the 586 review candidates, 575 are verified but not imported and 11 are existing held records. These are audit states, not a live DB count.

The existing EBSi June English solution is already an approved candidate, but a higher-priority broken KICE artifact is being served. Recovery must use the existing artifact failure/review and publication business logic after DB access is restored; source priority must not be bypassed. No production row has been changed.
