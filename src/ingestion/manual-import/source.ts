/**
 * 운영자 입력 source id. robots.txt 가 자동 수집을 막는 공식 사이트의 자료를 운영자가 브라우저에서 확인한
 * 공식 파일 URL 로 등록한다. 승인 전에는 서버가 이 source URL 에 요청하지 않는다.
 *
 * 좁은 예외: 브라우저 승인된 EBSi wdown.ebsi.co.kr 영어 해설/대본은 파생 학습자료 처리를 위해
 * 전용 allowlist SafeFetcher 로만 읽을 수 있다. 목록 discovery·KICE·교육청 URL에는 적용되지 않는다.
 */
export const OPERATOR_IMPORT_SOURCE_ID = "operator_import";

export function isOperatorImport(sourceId: string): boolean {
  return sourceId === OPERATOR_IMPORT_SOURCE_ID;
}
