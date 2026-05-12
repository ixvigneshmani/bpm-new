/* OS8 — CryptoService unit tests. */

import { describe, expect, it } from "vitest";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { CryptoService } from "../crypto.service";

function makeService(opts?: { key?: string | null; env?: string }) {
  const map: Record<string, string | undefined> = {
    ENCRYPTION_KEY: opts?.key === undefined
      ? randomBytes(32).toString("hex")
      : opts.key ?? undefined,
    NODE_ENV: opts?.env ?? "test",
  };
  // Minimal ConfigService stub — only .get(key) is read by the service.
  const config = {
    get: (key: string) => map[key],
  } as unknown as ConfigService;
  const svc = new CryptoService(config);
  svc.onModuleInit();
  return svc;
}

describe("CryptoService", () => {
  it("round-trips a plaintext string", () => {
    const svc = makeService();
    const plain = "hunter2-very-secret-token";
    const enc = svc.encrypt(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const svc = makeService();
    const plain = "same-input";
    const a = svc.encrypt(plain);
    const b = svc.encrypt(plain);
    expect(a).not.toBe(b);
    expect(svc.decrypt(a)).toBe(plain);
    expect(svc.decrypt(b)).toBe(plain);
  });

  it("passes through values that lack the v1 prefix on decrypt", () => {
    const svc = makeService();
    expect(svc.decrypt("legacy-plaintext")).toBe("legacy-plaintext");
  });

  it("encrypt is idempotent — already-encrypted input returns unchanged", () => {
    const svc = makeService();
    const enc = svc.encrypt("once");
    expect(svc.encrypt(enc)).toBe(enc);
  });

  it("isEncrypted matches v1 prefix only", () => {
    const svc = makeService();
    expect(svc.isEncrypted("enc:v1:foo:bar")).toBe(true);
    expect(svc.isEncrypted("plain")).toBe(false);
    expect(svc.isEncrypted(null)).toBe(false);
    expect(svc.isEncrypted(undefined)).toBe(false);
    expect(svc.isEncrypted("enc:v2:foo:bar")).toBe(false);
  });

  it("throws on tampered ciphertext (GCM auth tag rejects modified bytes)", () => {
    const svc = makeService();
    const enc = svc.encrypt("authentic");
    // Flip a bit in the ciphertext portion (after the last colon)
    const lastColon = enc.lastIndexOf(":");
    const tampered =
      enc.slice(0, lastColon + 1) +
      Buffer.from(enc.slice(lastColon + 1), "base64")
        .map((b, i) => (i === 0 ? b ^ 0x01 : b))
        .toString("base64");
    expect(() => svc.decrypt(tampered)).toThrow();
  });

  it("throws on wrong key", () => {
    const enc = makeService().encrypt("crossable");
    const svc2 = makeService(); // fresh service => fresh random key
    expect(() => svc2.decrypt(enc)).toThrow();
  });

  it("refuses non-32-byte keys", () => {
    expect(() => makeService({ key: "abcd" })).toThrow(/64-char hex/);
  });

  it("refuses to boot in production without ENCRYPTION_KEY", () => {
    expect(() => makeService({ key: null, env: "production" })).toThrow(
      /required in production/,
    );
  });

  it("warns but boots in development without ENCRYPTION_KEY (plaintext passthrough)", () => {
    const svc = makeService({ key: null, env: "development" });
    expect(svc.enabled()).toBe(false);
    // Dev fallback: encrypt is a no-op so dev workflows still function.
    expect(svc.encrypt("hello")).toBe("hello");
    expect(svc.decrypt("hello")).toBe("hello");
  });

  it("redact always returns the placeholder", () => {
    const svc = makeService();
    expect(svc.redact("enc:v1:anything")).toBe("<encrypted>");
    expect(svc.redact(null)).toBe("<encrypted>");
    expect(svc.redact(undefined)).toBe("<encrypted>");
  });
});
