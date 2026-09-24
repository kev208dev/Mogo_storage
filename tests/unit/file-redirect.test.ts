import { beforeEach, describe, expect, it, vi } from "vitest";

const getFile = vi.fn();
const getDownloadUrl = vi.fn();
const getFileUrl = vi.fn();

vi.mock("@/lib/data", () => ({ getRepository: () => ({ getFile }) }));
vi.mock("@/lib/storage", () => ({
  getStorageProvider: () => ({ name: "test", getDownloadUrl, getFileUrl }),
}));

const { redirectToFile } = await import("@/lib/server/file-redirect");

const file = {
  id: "f1",
  storageKey: "a/b.pdf",
  mimeType: "application/pdf",
  originalFileName: "b.pdf",
};

describe("redirectToFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("302 redirects to the storage download url", async () => {
    getFile.mockResolvedValue(file);
    getDownloadUrl.mockResolvedValue("https://cdn.example.com/a/b.pdf");
    const res = await redirectToFile("f1", "download");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://cdn.example.com/a/b.pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404 for malformed ids without touching the repository", async () => {
    const res = await redirectToFile("../etc/passwd", "download");
    expect(res.status).toBe(404);
    expect(getFile).not.toHaveBeenCalled();
  });

  it("404 with friendly HTML for unknown files", async () => {
    getFile.mockResolvedValue(null);
    const res = await redirectToFile("missing", "view");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("파일을 찾을 수 없습니다");
  });

  it("503 when the repository fails, without leaking details", async () => {
    getFile.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));
    const res = await redirectToFile("f1", "download");
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain("지금은 다운로드할 수 없습니다");
    expect(body).not.toContain("ECONNREFUSED");
  });

  it("502 when the storage provider fails, distinct from '준비 중'", async () => {
    getFile.mockResolvedValue(file);
    getDownloadUrl.mockRejectedValue(new Error("R2 secret key invalid at signer.ts:42"));
    const res = await redirectToFile("f1", "download");
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain("오류로 다운로드할 수 없습니다");
    expect(body).not.toContain("준비 중");
    expect(body).not.toContain("signer.ts");
  });
});
