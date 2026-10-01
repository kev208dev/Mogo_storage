import type { Metadata } from "next";
import { BookOpenIcon, HeadphonesIcon, PencilLineIcon, SpellCheckIcon } from "lucide-react";
import Link from "next/link";
import { ExamList } from "@/components/exam/ExamList";
import { ContinueStudy } from "@/components/exam/LastVisit";
import { UpcomingExams } from "@/components/exam/UpcomingExams";
import { JsonLd } from "@/components/layout/JsonLd";
import { ExamFinder } from "@/components/search/ExamFinder";
import { ExamSearch } from "@/components/search/ExamSearch";
import { CORE_SUBJECTS, GRADES, MONTHS, SITE_NAME, SUBJECT_LABELS } from "@/lib/constants";
import { getRepository, listAllExams } from "@/lib/data";
import { FEATURED_EXAM } from "@/lib/data/sample-data";
import { examPath, subjectSegment } from "@/lib/exam-path";
import { absoluteUrl } from "@/lib/site";
import { kstToday } from "@/lib/utils";

export const revalidate = 3600;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "ko_KR", siteName: SITE_NAME, url: "/" },
};

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
  // KST 오늘 (ISR 재생성 시점 기준 — 시간 단위 오차는 허용)
  const today = kstToday();
  const [years, recent, allExams, upcoming] = await Promise.all([
    repo.listYears(),
    repo.listRecentExams(9),
    listAllExams(),
    repo.listUpcomingSchedules(today, 6),
  ]);
  const latest = recent[0];
  const englishDemo = `${examPath(FEATURED_EXAM, "english")}`;
  // 실제 시험이 있는 달만 링크한다 (없는 달의 허브는 404)
  const monthLinks = MONTHS.filter((month) => allExams.some((exam) => exam.month === month));
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: "모고창고",
    url: absoluteUrl("/"),
    inLanguage: "ko-KR",
    description:
      "고1·고2·고3 모고·모의고사 문제지와 정답·해설, 영어 듣기, 자동 채점, 등급컷을 연도·월·과목별로 확인하는 서비스",
  };

  return (
    <div className="mx-auto max-w-2xl py-8 sm:py-12">
      <JsonLd data={websiteJsonLd} />
      <section aria-labelledby="hero-title">
        <h1 id="hero-title" className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          고1·고2·고3 모고·모의고사 자료
        </h1>
        <p className="text-muted-foreground mt-1">
          {SITE_NAME}에서 연도·학년·월·과목별 시험지와 정답·해설을 바로 찾으세요.
        </p>

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

      <section aria-labelledby="seo-nav-title" className="mt-8">
        <h2 id="seo-nav-title" className="text-lg font-bold">
          모고 빠르게 찾기
        </h2>
        <div className="mt-3 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">과목별</h3>
            <nav aria-label="과목별 모의고사" className="mt-1.5 flex flex-wrap gap-2">
              {CORE_SUBJECTS.map((subject) => (
                <Link
                  key={subject}
                  href={`/subject/${subjectSegment(subject)}`}
                  className="border-border hover:border-primary hover:text-primary inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold"
                >
                  {SUBJECT_LABELS[subject]} 모고
                </Link>
              ))}
            </nav>
          </div>
          <div>
            <h3 className="text-sm font-semibold">월별</h3>
            <nav aria-label="월별 모의고사" className="mt-1.5 flex flex-wrap gap-2">
              {monthLinks.map((month) => (
                <Link
                  key={month}
                  href={`/month/${month}`}
                  className="border-border hover:border-primary hover:text-primary inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold"
                >
                  {month}월 모고
                  {month === 3 || month === 6 || month === 9 ? ` · ${month}모` : ""}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </section>

      <ContinueStudy />
      <UpcomingExams schedules={upcoming} />

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
