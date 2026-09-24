/** 아주 작은 CLI 인자 파서: --key=value, --flag */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const arg of argv) {
    const m = /^--([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (m) out[m[1]!] = m[2] ?? true;
  }
  return out;
}

export function intArg(value: string | true | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`정수가 필요합니다: ${value}`);
  return n;
}

export function listArg(value: string | true | undefined): string[] | undefined {
  return typeof value === "string"
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
}
