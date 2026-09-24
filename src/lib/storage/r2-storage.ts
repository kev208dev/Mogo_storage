import { createHash, createHmac } from "node:crypto";
import { contentDisposition, type StorageFile, type StorageProvider } from "./types";

export interface R2Config {
  /** 공개 버킷/커스텀 도메인 주소. 있으면 미리보기는 CDN URL을 그대로 쓴다. */
  publicBaseUrl?: string;
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket?: string;
  /** Signed URL 만료(초) */
  expiresIn?: number;
}

/**
 * Cloudflare R2 구현체.
 *  - 미리보기: publicBaseUrl(CDN)이 있으면 `${publicBaseUrl}/${key}` 사용
 *  - 다운로드: credential이 있으면 S3 호환 SigV4 presigned URL(response-content-disposition 포함),
 *              없으면 CDN URL로 대체
 */
export class R2StorageProvider implements StorageProvider {
  readonly name = "r2";

  constructor(private readonly config: R2Config) {
    if (!config.publicBaseUrl && !this.canSign()) {
      throw new Error(
        "R2 storage requires R2_PUBLIC_BASE_URL or R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)",
      );
    }
  }

  async getFileUrl(file: StorageFile) {
    if (this.config.publicBaseUrl) return this.publicUrl(file.storageKey);
    return this.presign(file, "inline");
  }

  async getDownloadUrl(file: StorageFile) {
    if (this.canSign()) return this.presign(file, "attachment");
    return this.publicUrl(file.storageKey);
  }

  private canSign() {
    const c = this.config;
    return Boolean(c.accountId && c.accessKeyId && c.secretAccessKey && c.bucket);
  }

  private publicUrl(key: string) {
    const base = this.config.publicBaseUrl!.replace(/\/+$/, "");
    return `${base}/${encodeKey(key)}`;
  }

  /** AWS Signature V4 query-string presign (R2 region = "auto") */
  presign(file: StorageFile, disposition: "inline" | "attachment", now = new Date()): string {
    const { accountId, accessKeyId, secretAccessKey, bucket } = this.config;
    const host = `${accountId}.r2.cloudflarestorage.com`;
    const path = `/${bucket}/${encodeKey(file.storageKey)}`;
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const scope = `${day}/auto/s3/aws4_request`;

    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${accessKeyId}/${scope}`,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(this.config.expiresIn ?? 600),
      "X-Amz-SignedHeaders": "host",
      "response-content-disposition": contentDisposition(disposition, file.originalFileName),
      "response-content-type": file.mimeType,
    };
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${awsEncode(k)}=${awsEncode(query[k]!)}`)
      .join("&");
    const canonicalRequest = [
      "GET",
      path,
      canonicalQuery,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const kDate = hmac(`AWS4${secretAccessKey}`, day);
    const kRegion = hmac(kDate, "auto");
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
    return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}

function hmac(key: string | Buffer, data: string) {
  return createHmac("sha256", key).update(data).digest();
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKey(key: string) {
  return key.split("/").map(awsEncode).join("/");
}
