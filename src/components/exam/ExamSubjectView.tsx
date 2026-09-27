import Link from "next/link";
import { FullListeningPlayer } from "@/components/english/FullListeningPlayer";
import { DictationPractice } from "@/components/english/DictationPractice";
import { ListeningPlayer } from "@/components/english/ListeningPlayer";
import { VocabularyList } from "@/components/english/VocabularyList";
import { VocabularyQuiz } from "@/components/english/VocabularyQuiz";
import { SampleNotice } from "@/components/layout/SampleNotice";
import { Section } from "@/components/ui/section";
import { SUBJECT_LABELS } from "@/lib/constants";
import { SUBJECT_AREA_LABELS } from "@/lib/courses";
import type { ExamSubjectDetail } from "@/lib/data/types";
import { conceptPath, examCoursePath, examPath, examTitle } from "@/lib/exam-path";
import { AnswerSheet } from "./AnswerSheet";
import { CourseSelector } from "./CourseSelector";
import { DifficultQuestions } from "./DifficultQuestions";
import { ExamFiles } from "./ExamFiles";
import { ExamHeader } from "./ExamHeader";
import { ExamRelatedLinks } from "./ExamRelatedLinks";
import { ExamSchedulePanel } from "./ExamSchedulePanel";
import { fileViewHref } from "./FileDownloadCard";
import { GradeCutTable } from "./GradeCutTable";
import { QuestionExplorer } from "./QuestionExplorer";
import { QuickGrader } from "./QuickGrader";
import { SubjectTabs } from "./SubjectTabs";

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 시험 상세(과목) 화면.
 * 순서가 중요하다: 시험명 → 과목 선택 → 시험자료(다운로드) → 부가기능.
 * 다운로드 위에는 어떤 부가 요소도 두지 않는다.
 */
export function ExamSubjectView({ detail }: { detail: ExamSubjectDetail }) {
  const {
    exam,
    subjects,
    subject,
    courses,
    course,
    courseFileCounts,
    files,
    questions,
    gradeCuts,
    vocabulary,
    listeningTracks,
    schedule,
    processingTypes,
    conceptTags,
  } = detail;
  const subjectKey = subject.subject;
  const areaLabel = SUBJECT_AREA_LABELS[subjectKey] ?? SUBJECT_LABELS[subjectKey];
  const subjectLabel = course ? course.name : SUBJECT_LABELS[subjectKey];
  const extraCrumbs =
    courses.length > 0 || course
      ? [
          {
            label: areaLabel,
            href:
              examPath(exam, subjectKey) === examPath(exam)
                ? `${examPath(exam)}/${subjectKey}`
                : examPath(exam, subjectKey),
          },
          ...(course
            ? [{ label: course.name, href: examCoursePath(exam, subjectKey, course.code) }]
            : []),
        ]
      : [];
  // 세부과목이 있는 영역 페이지: 영역 전체(세부과목 구분 없는) 자료가 있을 때만 파일 목록을 보여준다
  const showFiles = Boolean(course) || courses.length === 0 || files.length > 0;
  /** 채점·해설 localStorage 구분용 (세부과목마다 따로 저장) */
  const progressKey = course ? `${subjectKey}:${course.code}` : subjectKey;
  const isEnglish = subjectKey === "english";
  const audioFile = files.find((f) => f.type === "listening_audio");
  const solutionFile = files.find((f) => f.type === "solution");
  const hasQuestions = questions.length > 0;

  const quickLinks = [
    hasQuestions && { href: "#answers", label: "정답" },
    hasQuestions && { href: "#grader", label: "자동 채점" },
    hasQuestions && { href: "#questions", label: "문항별 해설" },
    { href: "#grade-cuts", label: "등급컷" },
    isEnglish && vocabulary.length > 0 && { href: "#vocabulary", label: "단어장" },
    isEnglish && vocabulary.length > 0 && { href: "#vocabulary-quiz", label: "단어 시험" },
    isEnglish && (listeningTracks.length > 0 || audioFile) && { href: "#listening", label: "듣기" },
    isEnglish && listeningTracks.length > 0 && { href: "#dictation", label: "받아쓰기" },
  ].filter((x): x is { href: string; label: string } => Boolean(x));

  return (
    <article className="pb-6" data-exam-id={exam.id}>
      <ExamHeader
        exam={exam}
        subject={subjectKey}
        extraCrumbs={extraCrumbs}
        heading={course ? `${areaLabel} ${course.name}` : undefined}
      />
      <SubjectTabs exam={exam} subjects={subjects} current={subjectKey} />
      <CourseSelector
        exam={exam}
        subject={subjectKey}
        courses={courses}
        current={course}
        fileCounts={courseFileCounts}
      />
      {schedule && files.length === 0 && schedule.status !== "cancelled" ? (
        <ExamSchedulePanel schedule={schedule} today={todayKst()} />
      ) : null}
      {course ? (
        <h2 className="mt-4 text-lg font-bold">{course.name}</h2>
      ) : courses.length > 0 && files.length > 0 ? (
        <h2 className="text-muted-foreground mt-4 text-sm font-bold">
          {areaLabel} 전체 (세부과목 구분 없는 자료)
        </h2>
      ) : null}
      {showFiles ? (
        <ExamFiles
          files={files}
          examId={exam.id}
          subject={subjectKey}
          title={`${examTitle(exam)} ${subjectLabel}`}
          processingTypes={processingTypes}
        />
      ) : (
        <p className="border-border text-muted-foreground mt-4 rounded-md border px-3 py-3 text-sm">
          위에서 {areaLabel} 과목을 선택하면 시험지와 정답·해설을 받을 수 있습니다.
        </p>
      )}

      {exam.isSample ? (
        <SampleNotice className="mt-3">
          개발용 샘플 데이터입니다. 파일은 placeholder이며, 정답·통계·등급컷은 실제 시험과
          무관합니다.
        </SampleNotice>
      ) : null}

      <nav aria-label={`${subjectLabel} 부가기능 바로가기`} className="mt-5">
        <ul className="flex gap-1.5 overflow-x-auto pb-1 text-sm">
          {quickLinks.map((link) => (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                className="bg-muted hover:bg-muted-strong inline-flex min-h-10 items-center rounded-full px-3 font-semibold"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-4">
        {hasQuestions ? (
          <>
            <Section id="answers" title="정답 바로 보기">
              <AnswerSheet questions={questions} />
            </Section>

            <Section
              id="grader"
              title="자동 채점"
              description="답을 이어서 입력하거나 붙여넣으세요 (예: 34244125…). 입력한 답은 이 기기에만 저장됩니다."
            >
              <QuickGrader
                examId={exam.id}
                subject={progressKey}
                questions={questions.map(({ questionNumber, answer, score, choiceCount }) => ({
                  questionNumber,
                  answer,
                  score,
                  choiceCount,
                }))}
              />
            </Section>

            <Section id="questions" title="문항별 해설">
              <DifficultQuestions questions={questions} />
              <QuestionExplorer
                examId={exam.id}
                subject={progressKey}
                questions={questions}
                solutionHref={solutionFile ? fileViewHref(solutionFile.id) : null}
                tracks={isEnglish ? listeningTracks : []}
                vocabulary={isEnglish ? vocabulary : []}
                concepts={Object.fromEntries(
                  Object.entries(conceptTags).map(([id, tags]) => [
                    id,
                    tags.map((t) => ({ name: t.name, href: conceptPath(t.subject, t.slug) })),
                  ]),
                )}
              />
            </Section>
          </>
        ) : (
          <Section id="answers" title="정답 · 해설">
            <p className="text-muted-foreground text-sm">
              웹 정답·해설 데이터 준비 중입니다. 위의 정답·해설 PDF를 이용해 주세요.
            </p>
          </Section>
        )}

        <Section id="grade-cuts" title="등급컷" description="공식 자료와 기관별 예상 등급컷">
          <GradeCutTable gradeCuts={gradeCuts} subject={subjectKey} exam={exam} />
        </Section>

        {isEnglish && vocabulary.length > 0 ? (
          <>
            <Section id="vocabulary" title="지문별 단어장" description={`${vocabulary.length}단어`}>
              <VocabularyList items={vocabulary} />
            </Section>
            <Section id="vocabulary-quiz" title="단어 시험">
              <VocabularyQuiz examId={exam.id} items={vocabulary} />
            </Section>
          </>
        ) : null}

        {isEnglish && audioFile && listeningTracks.length > 0 ? (
          <>
            <Section
              id="listening"
              title="영어 듣기"
              description="문항별로 재생하고 대본을 확인하세요."
            >
              <ListeningPlayer tracks={listeningTracks} audioUrl={fileViewHref(audioFile.id)} />
            </Section>
            <Section id="dictation" title="받아쓰기">
              <DictationPractice tracks={listeningTracks} />
            </Section>
          </>
        ) : isEnglish && audioFile ? (
          // 문항별 구간·대본이 아직 없는 실제 시험: 공식 음원 전체만 재생 (구간·대본을 추측하지 않는다)
          <Section
            id="listening"
            title="영어 듣기"
            description="공식 듣기 음원 전체입니다. 문항별 구간과 대본은 공식 자료로 확인된 경우에만 제공합니다."
          >
            <FullListeningPlayer audioUrl={fileViewHref(audioFile.id)} />
          </Section>
        ) : null}
      </div>
      <ExamRelatedLinks exam={exam} />
    </article>
  );
}
