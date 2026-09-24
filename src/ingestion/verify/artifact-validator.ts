import { createHash } from "node:crypto";
import type { FileType } from "../../lib/constants";

export type ExpectedKind = "pdf" | "audio";

export function expectedKindFor(type: FileType): ExpectedKind {
  return type === "listening_audio" ? "audio" : "pdf";
}

export const MAX_ARTIFACT_BYTES: Record<ExpectedKind, number> = {
  pdf: 60 * 1024 * 1024,
  audio: 120 * 1024 * 1024,
};

/** PDF 치고 비정상적으로 작은 파일 (오류 안내 페이지 등) */
const MIN_BYTES: Record<ExpectedKind, number> = { pdf: 512, audio: 4 * 1024 };

export type ValidationResult =
  | { ok: true; sha256: string; size: number; mimeType: string }
  | { ok: false; code: string; message: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, "")
    .trimStart()
    .toLowerCase();
  return (
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<?xml") ||
    head.includes("<head") ||
    head.includes("<script")
  );
}

function isPdf(bytes: Uint8Array): boolean {
  // "%PDF-" 는 파일 앞 1024 byte 안에 있어야 한다 (PDF 스펙)
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

function isAudio(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // ID3
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return true; // MPEG frame sync
  const tag = new TextDecoder("latin1").decode(bytes.subarray(0, 12));
  if (tag.startsWith("RIFF") && tag.slice(8, 12) === "WAVE") return true;
  if (tag.slice(4, 8) === "ftyp") return true; // m4a
  return false;
}

/**
 * 다운로드한 자료 검증: HTTP status, Content-Type, magic bytes, 크기, zero-byte, HTML 오류 페이지.
 * 통과하면 SHA-256 을 돌려준다.
 */
export function validateArtifact(input: {
  status: number;
  contentType: string;
  bytes: Uint8Array;
  expected: ExpectedKind;
}): ValidationResult {
  const { status, bytes, expected } = input;
  const contentType = input.contentType.toLowerCase().split(";")[0]!.trim();
  if (status < 200 || status >= 300) {
    return { ok: false, code: "HTTP_STATUS", message: `unexpected HTTP status ${status}` };
  }
  if (bytes.byteLength === 0) return { ok: false, code: "EMPTY_FILE", message: "zero-byte file" };
  if (bytes.byteLength > MAX_ARTIFACT_BYTES[expected]) {
    return { ok: false, code: "TOO_LARGE", message: `file is ${bytes.byteLength} bytes` };
  }
  if (
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    looksLikeHtml(bytes)
  ) {
    return {
      ok: false,
      code: "HTML_RESPONSE",
      message: "server returned an HTML page instead of a file",
    };
  }
  if (bytes.byteLength < MIN_BYTES[expected]) {
    return { ok: false, code: "TOO_SMALL", message: `file is only ${bytes.byteLength} bytes` };
  }
  if (expected === "pdf") {
    if (!isPdf(bytes))
      return { ok: false, code: "INVALID_MAGIC", message: "not a PDF (missing %PDF- header)" };
    if (
      contentType &&
      ![
        "application/pdf",
        "application/octet-stream",
        "application/x-pdf",
        "binary/octet-stream",
        "application/download",
        "application/force-download",
      ].includes(contentType)
    ) {
      return {
        ok: false,
        code: "CONTENT_TYPE_MISMATCH",
        message: `unexpected content-type ${contentType}`,
      };
    }
    return {
      ok: true,
      sha256: sha256Hex(bytes),
      size: bytes.byteLength,
      mimeType: "application/pdf",
    };
  }
  if (!isAudio(bytes)) return { ok: false, code: "INVALID_MAGIC", message: "not an audio file" };
  if (
    contentType &&
    !contentType.startsWith("audio/") &&
    ![
      "application/octet-stream",
      "binary/octet-stream",
      "application/download",
      "application/force-download",
    ].includes(contentType)
  ) {
    return {
      ok: false,
      code: "CONTENT_TYPE_MISMATCH",
      message: `unexpected content-type ${contentType}`,
    };
  }
  return { ok: true, sha256: sha256Hex(bytes), size: bytes.byteLength, mimeType: "audio/mpeg" };
}

/** 원본 파일명 정리: 경로 구분자·제어문자 제거, 길이 제한 (외부 파일명은 신뢰하지 않는다) */
export function sanitizeFileName(raw: string, fallback: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 150);
  return cleaned || fallback;
}
