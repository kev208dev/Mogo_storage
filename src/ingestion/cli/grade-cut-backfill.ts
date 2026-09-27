import { GRADE_CUT_PROVIDERS, GRADE_CUT_PROVIDER_POLICIES } from "../grade-cuts/provider-registry";

function value(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const year = Number(value("year"));
const grade = value("grade") ? Number(value("grade")) : null;
const month = value("month") ? Number(value("month")) : null;
const limit = Number(value("limit") ?? "10");
const provider = value("provider");
const publish = process.argv.includes("--publish");
const dryRun = process.argv.includes("--dry-run");

if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("invalid --year");
if (grade !== null && ![1, 2, 3].includes(grade)) throw new Error("invalid --grade");
if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12))
  throw new Error("invalid --month");
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("invalid --limit");
if (provider && !GRADE_CUT_PROVIDERS.includes(provider as (typeof GRADE_CUT_PROVIDERS)[number]))
  throw new Error("invalid --provider");
if (publish === dryRun) throw new Error("choose exactly one of --dry-run or --publish");
if (publish && !process.env.INGESTION_DATABASE_URL)
  throw new Error("INGESTION_DATABASE_URL is required for publish");

const selected = provider
  ? [GRADE_CUT_PROVIDER_POLICIES[provider as keyof typeof GRADE_CUT_PROVIDER_POLICIES]]
  : Object.values(GRADE_CUT_PROVIDER_POLICIES);

console.log(
  JSON.stringify(
    {
      mode: publish ? "publish" : "dry-run",
      filters: { year, grade, month, provider, limit },
      providers: selected.map(({ provider, automation, reason }) => ({
        provider,
        automation,
        reason,
      })),
      publishable: selected.filter((item) => item.automation.startsWith("automated_")).length,
    },
    null,
    2,
  ),
);
