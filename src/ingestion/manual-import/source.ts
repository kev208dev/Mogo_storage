/**
 * 운영자 입력 source id. robots.txt 가 자동 수집을 막는 공식 사이트의 자료를 운영자가 브라우저에서 확인한
 * 공식 파일 URL 로 등록한다. 서버는 이 source 의 URL 에 절대 요청하지 않는다.
 */
export const OPERATOR_IMPORT_SOURCE_ID = "operator_import";

export function isOperatorImport(sourceId: string): boolean {
  return sourceId === OPERATOR_IMPORT_SOURCE_ID;
}
