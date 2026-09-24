import { BookOpenIcon, HeadphonesIcon, PencilLineIcon, SpellCheckIcon } from "lucide-react";
import Link from "next/link";
import { ExamList } from "@/components/exam/ExamList";
import { ExamFinder } from "@/components/search/ExamFinder";
import { ExamSearch } from "@/components/search/ExamSearch";
import { GRADES, SITE_NAME } from "@/lib/constants";
import { getRepository } from "@/lib/data";
import { FEATURED_EXAM } from "@/lib/data/sample-data";
import { examPath } from "@/lib/exam-path";

export const revalidate = 3600;

const ENGLISH_TOOLS = [
  {
    icon: BookOpenIcon,
    title: "지문별 단어장",
    body: "문항 번호별로 정리된 단어",
    anchor: "vocabulary",
  },
  {
    icon: SpellCheckIcon,
    title: "단어 시험",
    body: "객관식·주관식, 10~30문항",
    anchor: "vocabulary-quiz",
  },
  {
    icon: HeadphonesIcon,
    title: "영어 듣기",
    body: "문항별 재생, 0.75~1.5배속",
    anchor: "listening",
  },
  { icon: PencilLineIcon, title: "받아쓰기", body: "쉬움·보통·어려움 3단계", anchor: "dictation" },
] as const;

export default async function HomePage() {
  const repo = getRepository();
  const [years, recent] = await Promise.all([repo.listYears(), repo.listRecentExams(9)]);
  const latest = recent[0];
  const englishDemo = `${examPath(FEATURED_EXAM, "english")}`;

  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-12">
      <section aria-labelledby="hero-title">
        <h1 id="hero-title" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {SITE_NAME}
        </h1>
        <p className="text-muted-foreground mt-1">찾는 모의고사를 바로 다운로드하세요.</p>

        <div className="mt-5 space-y-3">
          <ExamFinder
            years={years}
            defaultValue={
              latest
                ? { year: latest.year, grade: latest.grade, month: latest.month }
                : FEATURED_EXAM
            }
          />
          <ExamSearch />
        </div>
      </section>

      <section aria-labelledby="recent-title" className="mt-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="recent-title" className="text-lg font-bold">
            최근 모의고사
          </h2>
          <nav aria-label="학년별 전체 보기" className="flex gap-1 text-sm">
            {GRADES.map((g) => (
              <Link
                key={g}
                href={`/grade/high${g}`}
                className="text-primary hover:bg-primary-soft inline-flex min-h-11 items-center rounded-md px-2 font-semibold"
              >
                고{g} 전체
              </Link>
            ))}
          </nav>
        </div>
        <ExamList exams={recent} />
      </section>

      <section aria-labelledby="english-tools-title" className="mt-10">
        <h2 id="english-tools-title" className="text-lg font-bold">
          영어 학습 도구
        </h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          시험 페이지의 영어 탭에서 바로 사용할 수 있습니다.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-2">
          {ENGLISH_TOOLS.map(({ icon: Icon, title, body, anchor }) => (
            <li key={title}>
              <Link
                href={`${englishDemo}#${anchor}`}
                className="border-border hover:bg-muted flex h-full items-start gap-2.5 rounded-md border p-3"
              >
                <Icon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="text-muted-foreground block text-xs">{body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground mt-2 text-xs">
          예시: 2025년 고2 9월 영어 (개발용 샘플 데이터)
        </p>
      </section>
    </div>
  );
}
