import Link from "next/link";
import { DictationPractice } from "@/components/english/DictationPractice";
import { EnglishAvailability } from "@/components/english/EnglishAvailability";
import { ReadingNotes } from "@/components/english/ReadingNotes";
import { TranscriptList } from "@/components/english/TranscriptList";
import { FullListeningPlayer } from "@/components/english/FullListeningPlayer";
import { ListeningPlayer } from "@/components/english/ListeningPlayer";
import { VocabularyList } from "@/components/english/VocabularyList";
import { VocabularyQuiz } from "@/components/english/VocabularyQuiz";
import { JsonLd } from "@/components/layout/JsonLd";
import { SampleNotice } from "@/components/layout/SampleNotice";
import { Section } from "@/components/ui/section";
import { GRADE_CUT_SOURCE_LABELS, SUBJECT_LABELS, WORKSHEET_FILE_TYPES } from "@/lib/constants";
import { SUBJECT_AREA_LABELS } from "@/lib/courses";
import type { ExamSubjectDetail } from "@/lib/data/types";
import {
  buildExamStructuredData,
  examContentWords,
  examSeoFeatures,
  examSeoOptions,
} from "@/lib/exam-metadata";
import { conceptPath, examCoursePath, examPath, examTitle } from "@/lib/exam-path";
import { listeningMode, transcriptTracks, verifiedSegments } from "@/lib/listening";
import { englishAvailability } from "@/lib/study";
import { AnswerSheet } from "./AnswerSheet";
import { CourseOverview } from "./CourseOverview";
import { CourseSelector } from "./CourseSelector";
import { DifficultQuestions } from "./DifficultQuestions";
import { ExamFiles } from "./ExamFiles";
import { ExamHeader } from "./ExamHeader";
import { ExamRelatedLinks } from "./ExamRelatedLinks";
import { ExamSchedulePanel } from "./ExamSchedulePanel";
import { FileDownloadCard, fileViewHref } from "./FileDownloadCard";
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
    courseSummaries,
    files,
    questions,
    gradeCuts,
    vocabulary,
    listeningTracks,
    schedule,
    processingTypes,
    conceptTags,
    readingNotes,
    pendingMaterialKinds,
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
  // 기본 과목(국어) 첫 페이지는 시험 전체 페이지다 — metadata 와 같은 기준으로 과목을 넣지 않는다
  const seoSubject = !course && examPath(exam, subjectKey) === examPath(exam) ? null : subjectKey;
  const structuredData = buildExamStructuredData(
    exam,
    subjects,
    seoSubject,
    examSeoOptions(detail),
  );
  const contentWords = examContentWords(examSeoFeatures(detail));

  const transcripts = isEnglish ? transcriptTracks(listeningTracks) : [];
  const worksheets = isEnglish
    ? files.filter(
        (f) =>
          f.type !== "vocabulary_pdf" &&
          (WORKSHEET_FILE_TYPES as readonly string[]).includes(f.type),
      )
    : [];
  const englishItems = isEnglish
    ? englishAvailability({
        fileTypes: files.map((f) => f.type),
        processingTypes,
        vocabularyCount: vocabulary.length,
        transcriptCount: transcripts.length,
        verifiedSegmentCount: verifiedSegments(listeningTracks).length,
        questionCount: questions.length,
        explainedQuestionCount: questions.filter((q) => q.explanation).length,
        readingNotes,
        pendingMaterialKinds,
        publishedWorksheetTypes: worksheets.map((f) => f.type),
      })
    : [];

  const quickLinks = [
    courseSummaries.length > 0 && { href: "#course-overview-heading", label: "세부과목" },
    showFiles && { href: "#files-heading", label: "PDF" },
    hasQuestions && { href: "#answers", label: "정답" },
    hasQuestions && { href: "#grader", label: "자동 채점" },
    hasQuestions && { href: "#questions", label: "문항별 해설" },
    { href: "#grade-cuts", label: "등급컷" },
    isEnglish && { href: "#english-study", label: "영어 학습 현황" },
    isEnglish && vocabulary.length > 0 && { href: "#vocabulary", label: "단어장" },
    isEnglish && vocabulary.length > 0 && { href: "#vocabulary-quiz", label: "단어 시험" },
    isEnglish && (audioFile || transcripts.length > 0) && { href: "#listening", label: "듣기" },
    isEnglish && transcripts.length > 0 && { href: "#dictation", label: "받아쓰기" },
    isEnglish && readingNotes.length > 0 && { href: "#reading", label: "독해 학습" },
    isEnglish && worksheets.length > 0 && { href: "#worksheets", label: "학습지" },
  ].filter((x): x is { href: string; label: string } => Boolean(x));

  return (
    <>
      <article className="pb-6" data-exam-id={exam.id}>
        <ExamHeader
          exam={exam}
          extraCrumbs={extraCrumbs}
          subtitle={`${course ? `${areaLabel} ${course.name}` : SUBJECT_LABELS[subjectKey]}${
            contentWords ? ` ${contentWords}` : ""
          }`}
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
        ) : null}
        {!course && courseSummaries.length > 0 ? (
          <CourseOverview exam={exam} subject={subjectKey} summaries={courseSummaries} />
        ) : null}

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
          {isEnglish ? (
            <Section
              id="english-study"
              title="영어 학습 자료 현황"
              description="실제로 확인된 자료만 '있음'으로 표시합니다."
            >
              <EnglishAvailability items={englishItems} />
            </Section>
          ) : null}
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
            <GradeCutTable
              gradeCuts={gradeCuts}
              subject={subjectKey}
              exam={exam}
              courseCuts={courseSummaries.map((c) => ({
                name: c.name,
                href: `${examCoursePath(exam, subjectKey, c.code)}#grade-cuts`,
                providers: c.gradeCuts.map((g) => GRADE_CUT_SOURCE_LABELS[g.source]),
              }))}
            />
          </Section>

          {isEnglish ? (
            <>
              {vocabulary.length > 0 ? (
                <>
                  <Section
                    id="vocabulary"
                    title="지문별 단어장"
                    description={`${vocabulary.length}단어 · 공식 해설 자료에서 추출해 모의고사 창고가 정리한 학습 자료입니다.`}
                  >
                    <VocabularyList
                      items={vocabulary}
                      title={`${examTitle(exam)} 영어 지문별 단어장`}
                    />
                  </Section>
                  <Section id="vocabulary-quiz" title="단어 시험">
                    <VocabularyQuiz examId={exam.id} items={vocabulary} />
                  </Section>
                </>
              ) : null}

              {audioFile && listeningMode(listeningTracks) === "segments" ? (
                <Section
                  id="listening"
                  title="영어 듣기"
                  description="검증된 문항 구간으로 재생합니다. 대본은 공식 자료로 확인된 경우에만 제공합니다."
                >
                  <ListeningPlayer tracks={listeningTracks} audioUrl={fileViewHref(audioFile.id)} />
                </Section>
              ) : audioFile || transcripts.length > 0 ? (
                // 문항별 구간이 검증되지 않은 시험: 공식 음원 전체만 재생 (구간을 추측하지 않는다)
                <Section
                  id="listening"
                  title="영어 듣기"
                  description="공식 듣기 음원 전체입니다. 문항별 구간은 공식 자료로 검증된 경우에만 제공합니다."
                >
                  {audioFile ? <FullListeningPlayer audioUrl={fileViewHref(audioFile.id)} /> : null}
                  {transcripts.length > 0 ? <TranscriptList tracks={transcripts} /> : null}
                </Section>
              ) : null}

              {transcripts.length > 0 ? (
                <Section id="dictation" title="받아쓰기">
                  <DictationPractice examId={exam.id} tracks={listeningTracks} />
                </Section>
              ) : null}

              {readingNotes.length > 0 ? (
                <Section id="reading" title="독해 학습">
                  <ReadingNotes
                    notes={readingNotes}
                    solutionHref={solutionFile ? fileViewHref(solutionFile.id) : null}
                  />
                </Section>
              ) : null}

              {worksheets.length > 0 ? (
                <Section
                  id="worksheets"
                  title="학습지"
                  description="모의고사 창고가 만든 학습지입니다 (공식 시험 자료 아님). 관리자 검토 후 게시합니다."
                >
                  <ul className="divide-border border-border divide-y rounded-md border px-3">
                    {worksheets.map((f) => (
                      <FileDownloadCard
                        key={f.id}
                        type={f.type}
                        file={f}
                        examId={exam.id}
                        subject={subjectKey}
                        title={`${examTitle(exam)} 영어`}
                      />
                    ))}
                  </ul>
                </Section>
              ) : null}
            </>
          ) : null}
        </div>
        <ExamRelatedLinks exam={exam} subject={subjectKey} />
      </article>
      {/* BreadcrumbList(머리말) 다음에 CollectionPage */}
      <JsonLd data={structuredData} />
    </>
  );
}
