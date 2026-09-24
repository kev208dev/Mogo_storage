import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="border-border bg-muted mt-12 border-t">
      <div className="text-muted-foreground mx-auto max-w-5xl space-y-3 px-4 py-8 text-sm">
        <p className="text-foreground font-semibold">{SITE_NAME}</p>
        {process.env.DATABASE_URL ? (
          <p>
            시험 자료는 각 자료에 표시된 공식 출처에서 제공됩니다. 단어장 PDF 는 모의고사 창고가
            공식 해설 자료를 바탕으로 만든 학습 자료입니다.
          </p>
        ) : (
          <p>
            현재 표시되는 시험 정답·해설·정답률·등급컷·단어장·듣기 대본은 모두{" "}
            <strong className="text-foreground">개발용 샘플 데이터</strong>이며 실제 시험 자료가
            아닙니다.
          </p>
        )}
        <p>
          시험 문제의 저작권은 출제 기관에 있습니다. 자료 오류는 각 시험 페이지의 [오류 신고]로
          알려주세요.
        </p>
        <nav aria-label="바로가기">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <Link className="underline-offset-2 hover:underline" href="/grade/high1">
                고1 모의고사
              </Link>
            </li>
            <li>
              <Link className="underline-offset-2 hover:underline" href="/grade/high2">
                고2 모의고사
              </Link>
            </li>
            <li>
              <Link className="underline-offset-2 hover:underline" href="/grade/high3">
                고3 모의고사
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
