/** 듣기 플레이어 ↔ 받아쓰기 연결용 window 이벤트 */
export const LISTENING_PLAY_EVENT = "mogo:listening-play";
export const DICTATION_SELECT_EVENT = "mogo:dictation-select";

export function playListeningTrack(questionNumber: number | null) {
  window.dispatchEvent(new CustomEvent(LISTENING_PLAY_EVENT, { detail: questionNumber }));
}

export function openDictation(questionNumber: number) {
  window.dispatchEvent(new CustomEvent(DICTATION_SELECT_EVENT, { detail: questionNumber }));
}
