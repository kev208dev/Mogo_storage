import { describe, expect, it } from "vitest";
import { createPlaceholderPdf, createSilentWav } from "@/lib/storage/mock-files";
import { MockStorageProvider } from "@/lib/storage/mock-storage";
import { R2StorageProvider } from "@/lib/storage/r2-storage";
import { contentDisposition } from "@/lib/storage/types";

const file = {
  storageKey: "exams/2025/high2/09/english/question.pdf",
  mimeType: "application/pdf",
  originalFileName: "2025년 고2 9월 영어 문제.pdf",
};

describe("MockStorageProvider", () => {
  it("returns mock route urls", async () => {
    const storage = new MockStorageProvider();
    const url = await storage.getDownloadUrl(file);
    expect(url.startsWith("/api/mock-storage/exams/2025/high2/09/english/question.pdf?")).toBe(
      true,
    );
    expect(url).toContain("disposition=attachment");
    expect(await storage.getFileUrl(file)).toContain("disposition=inline");
  });
});

describe("R2StorageProvider", () => {
  it("uses public CDN url for preview", async () => {
    const r2 = new R2StorageProvider({ publicBaseUrl: "https://files.example.com/" });
    expect(await r2.getFileUrl(file)).toBe(
      "https://files.example.com/exams/2025/high2/09/english/question.pdf",
    );
  });

  it("creates presigned download url when credentials exist", async () => {
    const r2 = new R2StorageProvider({
      accountId: "acc",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      bucket: "mogo",
    });
    const url = new URL(await r2.getDownloadUrl(file));
    expect(url.host).toBe("acc.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/mogo/exams/2025/high2/09/english/question.pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment");
  });

  it("requires some configuration", () => {
    expect(() => new R2StorageProvider({})).toThrow();
  });
});

describe("mock files", () => {
  it("creates a valid-looking PDF", () => {
    const text = new TextDecoder().decode(createPlaceholderPdf(["hello"]));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });
  it("creates a WAV with correct size", () => {
    const wav = createSilentWav(1);
    expect(wav.byteLength).toBe(44 + 8000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  });
  it("encodes Korean file names in content-disposition", () => {
    const header = contentDisposition("attachment", "영어 문제.pdf");
    expect(header).toContain("filename*=UTF-8''%EC%98%81%EC%96%B4%20%EB%AC%B8%EC%A0%9C.pdf");
  });
});
