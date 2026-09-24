import type { Fetcher } from "../../net/fetcher";
import type { SourceConfig } from "../../types";
import { BoardExamSource } from "../board/adapter";
import { EDUCATION_OFFICE_DEFINITION } from "./structure";

/** 전국연합학력평가 출제 교육청 자료실 */
export class EducationOfficeExamSource extends BoardExamSource {
  constructor(source: SourceConfig, fetcher: Fetcher, now?: () => Date) {
    super(source, EDUCATION_OFFICE_DEFINITION, fetcher, now);
  }
}
