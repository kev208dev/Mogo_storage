/**
 * 최소 robots.txt 해석기. User-agent "*" 또는 우리 봇 이름 그룹의 Allow/Disallow 를 따른다.
 * (가장 긴 일치 규칙 우선, 동률이면 Allow 우선 — Google 방식)
 */
export interface RobotsRules {
  rules: Array<{ allow: boolean; path: string }>;
  crawlDelaySeconds: number | null;
}

export function parseRobots(text: string, botName: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules["rules"]; delay: number | null }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], delay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.rules.push({ allow: false, path: value });
    if (key === "allow" && value) current.rules.push({ allow: true, path: value });
    if (key === "crawl-delay" && Number.isFinite(Number(value))) current.delay = Number(value);
  }
  const bot = botName.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && bot.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: chosen.find((g) => g.delay !== null)?.delay ?? null,
  };
}

function toRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${escaped.endsWith("$") ? escaped : escaped}`);
}

export function isPathAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of rules.rules) {
    if (toRegex(rule.path).test(pathWithQuery)) {
      const length = rule.path.length;
      if (!best || length > best.length || (length === best.length && rule.allow)) {
        best = { allow: rule.allow, length };
      }
    }
  }
  return best ? best.allow : true;
}
