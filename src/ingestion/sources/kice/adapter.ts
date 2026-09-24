import type { Fetcher } from "../../net/fetcher";
import type { SourceConfig } from "../../types";
import { BoardExamSource } from "../board/adapter";
import { KICE_DEFINITION } from "./structure";

/** 평가원 시행 시험(6·9월 모의평가, 수능)의 canonical source */
export class KiceExamSource extends BoardExamSource {
  constructor(source: SourceConfig, fetcher: Fetcher, now?: () => Date) {
    super(source, KICE_DEFINITION, fetcher, now);
  }
}
