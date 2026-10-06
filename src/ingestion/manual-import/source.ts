/**
 * 운영자 입력 source id. robots.txt 가 자동 수집을 막는 공식 사이트의 자료를 운영자가 브라우저에서 확인한
 * 공식 파일 URL 로 등록한다. discovery/verify 단계는 이 source URL 에 요청하지 않는다.
 * 단, 브라우저 승인 후 게시된 EBSi direct-file 은 별도 영어 후처리에서 좁은 file allowlist 로만 읽을 수 있다.
 */
export const OPERATOR_IMPORT_SOURCE_ID = "operator_import";

export function isOperatorImport(sourceId: string): boolean {
  return sourceId === OPERATOR_IMPORT_SOURCE_ID;
}
