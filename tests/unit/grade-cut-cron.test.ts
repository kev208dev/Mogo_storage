import { describe, expect, it, vi } from "vitest";
import { checkCronAuth } from "../../src/lib/server/cron-auth";
import { withAdvisoryLock } from "../../src/ingestion/pipeline/locks";
import type { Database } from "../../src/db/client";

describe("grade cut cron protection", () => {
  it("requires a valid configured bearer secret", () => {
    const prior = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect(checkCronAuth(new Request("https://example.org/api/cron/grade-cuts"))).toBe("disabled");
      process.env.CRON_SECRET = "a-long-secret-for-tests";
      expect(checkCronAuth(new Request("https://example.org/api/cron/grade-cuts"))).toBe("unauthorized");
      expect(checkCronAuth(new Request("https://example.org/api/cron/grade-cuts", {
        headers: { authorization: "Bearer a-long-secret-for-tests" },
      }))).toBe("ok");
    } finally {
      if (prior === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prior;
    }
  });
  it("does not execute a second invocation when the advisory lock is held", async () => {
    const release = vi.fn();
    const conn = Object.assign(vi.fn(async () => [{ locked: false }]), { release });
    const db = { $client: { reserve: async () => conn } } as unknown as Database;
    const work = vi.fn(async () => "changed");
    expect(await withAdvisoryLock(db, "ingest:grade-cuts", work)).toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
