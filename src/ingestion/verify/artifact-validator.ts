import { createHash } from "node:crypto";
import type { FileType } from "../../lib/constants";
import { isHostAllowed } from "../net/url-policy";

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

/** probe 에서 읽는 앞부분 크기: magic bytes, HTML 오류 페이지 판별에 충분하다 */
export const PROBE_BYTES = 4096;

export type ProbeResult =
  | {
      ok: true;
      /** 내용 변경 감지용 식별자 (전체 hash 가 아님): 최종 URL + 크기 + ETag/Last-Modified + 앞부분 hash */
      fingerprint: string;
      size: number | null;
      mimeType: string;
      finalUrl: string;
    }
  | { ok: false; code: string; message: string };

/**
 * metadata 검증 (파일 전체를 받지 않음): HTTP status, Content-Type, magic bytes, 크기(content-length),
 * redirect 최종 목적지와 허용 도메인. source_redirect 자료는 이것으로 충분하다 — 우리 서버에 저장하지 않으므로.
 */
export function validateArtifactProbe(input: {
  status: number;
  contentType: string;
  headBytes: Uint8Array;
  truncated: boolean;
  declaredSize: number | null;
  finalUrl: string;
  allowedHosts: string[];
  expected: ExpectedKind;
  etag?: string | null;
  lastModified?: string | null;
}): ProbeResult {
  let host: string;
  try {
    host = new URL(input.finalUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, code: "INVALID_FINAL_URL", message: "redirect destination is not a URL" };
  }
  if (!isHostAllowed(host, input.allowedHosts)) {
    return {
      ok: false,
      code: "UNEXPECTED_DOMAIN",
      message: `redirect destination ${host} is not an allowlisted source domain`,
    };
  }
  // 크기: 전체를 읽지 않았으면 content-length 로 판단한다
  const size = input.truncated ? input.declaredSize : input.headBytes.byteLength;
  if (size !== null && size > MAX_ARTIFACT_BYTES[input.expected]) {
    return { ok: false, code: "TOO_LARGE", message: `file is ${size} bytes` };
  }
  // magic bytes · HTML 오류 페이지 · content-type 은 전체 검증과 같은 규칙 (크기 하한만 실제 크기로)
  const head = validateArtifact({
    status: input.status,
    contentType: input.contentType,
    bytes: input.headBytes,
    expected: input.expected,
  });
  if (!head.ok && !(head.code === "TOO_SMALL" && input.truncated)) return head;
  if (!input.truncated && size !== null && size < MIN_BYTES[input.expected]) {
    return { ok: false, code: "TOO_SMALL", message: `file is only ${size} bytes` };
  }
  const fingerprint = `probe:${sha256Hex(
    new TextEncoder().encode(
      [
        input.finalUrl,
        size ?? "?",
        input.etag ?? "",
        input.lastModified ?? "",
        sha256Hex(input.headBytes),
      ].join("\n"),
    ),
  ).slice(0, 40)}`;
  return {
    ok: true,
    fingerprint,
    size,
    mimeType: input.expected === "audio" ? "audio/mpeg" : "application/pdf",
    finalUrl: input.finalUrl,
  };
}
