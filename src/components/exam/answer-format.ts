import { CHOICE_SYMBOLS } from "@/lib/constants";

/** "3" → "③" (단답형은 숫자 그대로) */
export function formatAnswer(answer: string, choiceCount: number | null): string {
  if (choiceCount) {
    const symbol = CHOICE_SYMBOLS[Number(answer) - 1];
    if (symbol) return symbol;
  }
  return answer;
}
