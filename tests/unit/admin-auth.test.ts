import { describe, expect, it } from "vitest";
import {
  createSessionValue,
  getAdminConfig,
  readSession,
  verifyCredentials,
} from "@/lib/server/admin-auth";

const env = {
  ADMIN_EMAIL_ALLOWLIST: "ops@example.com, Admin@Example.com",
  ADMIN_ACCESS_TOKEN: "t".repeat(32),
  ADMIN_SESSION_SECRET: "s".repeat(40),
} as unknown as NodeJS.ProcessEnv;

describe("admin auth", () => {
  it("is disabled unless every secret is configured", () => {
    expect(getAdminConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getAdminConfig({ ...env, ADMIN_ACCESS_TOKEN: "short" })).toBeNull();
    expect(getAdminConfig({ ...env, ADMIN_EMAIL_ALLOWLIST: "" })).toBeNull();
    expect(getAdminConfig(env)?.allowlist).toEqual(["ops@example.com", "admin@example.com"]);
  });

  it("requires an allowlisted email AND the access token", () => {
    const config = getAdminConfig(env)!;
    expect(verifyCredentials(config, "OPS@example.com", "t".repeat(32))).toBe("ops@example.com");
    expect(verifyCredentials(config, "intruder@example.com", "t".repeat(32))).toBeNull();
    expect(verifyCredentials(config, "ops@example.com", "wrong")).toBeNull();
  });

  it("signed sessions expire and cannot be forged", () => {
    const config = getAdminConfig(env)!;
    const now = Date.now();
    const value = createSessionValue(config, "ops@example.com", now);
    expect(readSession(config, value, now)).toBe("ops@example.com");
    expect(readSession(config, value, now + 13 * 3600 * 1000)).toBeNull();
    const [payload] = value.split(".");
    const forged = `${Buffer.from(JSON.stringify({ e: "ops@example.com", x: 9e9 })).toString("base64url")}.${value.split(".")[1]}`;
    expect(readSession(config, forged, now)).toBeNull();
    expect(readSession(config, `${payload}.AAAA`, now)).toBeNull();
    // allowlist 에서 제거되면 기존 세션도 무효
    const narrowed = getAdminConfig({ ...env, ADMIN_EMAIL_ALLOWLIST: "admin@example.com" })!;
    expect(readSession(narrowed, value, now)).toBeNull();
  });
});
