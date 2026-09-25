# 2026 official material coverage audit — through September

## Result

- EBSi official catalog entries: 182.
- Verified official PDFs: 364 (182 question, 182 solution).
- Downloaded for verification: 393,330,044 bytes across 2,280 pages.
- Unique URLs and modeled slots: 364 / 364.
- Every candidate remains `manual_review` / `not_imported` until the production-connected database import and approval path is available.

## Coverage

| Grade | Month | Question + solution PDFs |
| --- | ---: | ---: |
| 고1 | 3월 | 12 |
| 고1 | 6월 | 12 |
| 고1 | 9월 | 12 |
| 고2 | 3월 | 12 |
| 고2 | 6월 | 12 |
| 고2 | 9월 | 12 |
| 고3 | 3월 | 40 |
| 고3 | 5월 | 48 |
| 고3 | 6월 | 78 |
| 고3 | 7월 | 48 |
| 고3 | 9월 | 78 |

The canonical question/solution matrix has no gaps for the official material published through 2026-09-26.
Listening audio and listening scripts are outside this question/solution pass.

## Evidence

- [EBSi previous-paper catalog](https://www.ebsi.co.kr/ebs/xip/xipc/previousPaperList.ebs) supplied every recorded URL; no URL was guessed or generated.
- Each file returned a PDF, was hashed, inspected with `pdfinfo`, had its first page extracted, and was rendered into grade/month contact sheets for visual inspection.
- The inventory records 11 exams: three each for high1 and high2, and five for high3.

## Publication state

The repository candidates are ready for the existing operator import and browser-confirmed approval workflow. Live DB access was unavailable during this pass, so no candidate is represented as public.
