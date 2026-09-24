import { describe, expect, it } from "vitest";
import { reportInputSchema } from "@/lib/report-schema";
import { RateLimiter } from "@/lib/server/rate-limit";

describe("reportInputSchema", () => {
  it("accepts a valid report and normalizes empty message", () => {
    const r = reportInputSchema.parse({ examId: "exam_1", category: "file_broken", message: "  " });
    expect(r.message).toBeNull();
  });
  it("rejects unknown category and long messages", () => {
    expect(reportInputSchema.safeParse({ examId: "e", category: "spam" }).success).toBe(false);
    expect(
      reportInputSchema.safeParse({ examId: "e", category: "other", message: "a".repeat(1001) })
        .success,
    ).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("blocks after max hits within window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take("ip", 0)).toBe(true);
    expect(limiter.take("ip", 10)).toBe(true);
    expect(limiter.take("ip", 20)).toBe(false);
    expect(limiter.take("other", 20)).toBe(true);
    expect(limiter.take("ip", 1500)).toBe(true);
  });
});
