/* OS8 — Encrypt-at-rest helper.
 *
 * One central service for symmetric encryption of column-level
 * secrets (webhook signing secrets, SMTP passwords, env-binding
 * secret values, anything credential-shaped we add later).
 *
 * Algorithm: AES-256-GCM. 12-byte random IV per ciphertext, 16-byte
 * authentication tag appended to the ciphertext. Output format:
 *
 *   enc:v1:<base64-iv>:<base64-ciphertext-with-tag>
 *
 * The "v1" prefix gives us a clean rotation path: a future v2 (e.g.
 * KMS-wrapped DEK, ChaCha20-Poly1305, longer keys) can coexist with
 * v1 ciphertexts in the table. Decrypt branches on the prefix.
 *
 * Master key: 64-char hex string (32 bytes) in ENCRYPTION_KEY env.
 * Refused at boot when NODE_ENV=production and missing or short.
 * Dev defaults are NOT provided — every environment must set one.
 */

import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/** Recognisable, low-cardinality prefix so we can scan the DB for
 *  "already encrypted" rows during the one-time migration without
 *  parsing the whole value. */
const PREFIX = "enc:v1:";

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key: Buffer | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const raw = this.config.get<string>("ENCRYPTION_KEY");
    const env = this.config.get<string>("NODE_ENV") ?? "development";

    if (!raw) {
      if (env === "production") {
        throw new Error(
          "ENCRYPTION_KEY is required in production. Generate one via " +
            "`openssl rand -hex 32` and set it in .env.production.",
        );
      }
      this.logger.warn(
        "ENCRYPTION_KEY is unset; secrets will be stored UNENCRYPTED. " +
          "Acceptable for dev only — must be set before any prod deploy.",
      );
      return;
    }

    const buf = Buffer.from(raw, "hex");
    if (buf.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must be a 64-char hex string (32 bytes). ` +
          `Got ${raw.length} chars / ${buf.length} bytes.`,
      );
    }
    this.key = buf;
    this.logger.log("CryptoService ready (AES-256-GCM, v1)");
  }

  /** True if a CryptoService key is configured. Producers can branch
   *  on this to decide whether to call `encrypt()` or store plaintext
   *  (dev convenience). Always true in production. */
  enabled(): boolean {
    return this.key !== null;
  }

  /** True if the value carries the v1 prefix. Used by the one-time
   *  migration to skip already-encrypted rows. */
  isEncrypted(value: string | null | undefined): boolean {
    return typeof value === "string" && value.startsWith(PREFIX);
  }

  /** Encrypt a plaintext string. Refuses to "encrypt" an already-
   *  encrypted value (returns it unchanged) so migrate scripts are
   *  idempotent. */
  encrypt(plaintext: string): string {
    if (!this.key) {
      // Dev fallback: store plaintext if no key is configured. This
      // matches the pre-OS8 behaviour so a developer without
      // ENCRYPTION_KEY can still run the app. Production boot
      // assertion above prevents this branch from ever firing in prod.
      return plaintext;
    }
    if (this.isEncrypted(plaintext)) return plaintext;

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([enc, tag]);
    return `${PREFIX}${iv.toString("base64")}:${combined.toString("base64")}`;
  }

  /** Decrypt a value produced by encrypt(). Pass-through for values
   *  that don't carry the v1 prefix (legacy plaintext rows from
   *  before the migration). */
  decrypt(stored: string): string {
    if (!this.isEncrypted(stored)) return stored;
    if (!this.key) {
      throw new InternalServerErrorException(
        "Encountered an encrypted value but no ENCRYPTION_KEY is configured.",
      );
    }
    const body = stored.slice(PREFIX.length);
    const colon = body.indexOf(":");
    if (colon < 0) {
      throw new InternalServerErrorException("Malformed encrypted value.");
    }
    const iv = Buffer.from(body.slice(0, colon), "base64");
    const combined = Buffer.from(body.slice(colon + 1), "base64");
    if (combined.length < 16) {
      throw new InternalServerErrorException("Ciphertext too short.");
    }
    const tag = combined.subarray(combined.length - 16);
    const enc = combined.subarray(0, combined.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString("utf8");
  }

  /** UI-safe placeholder used by list/read endpoints that should
   *  never expose the real secret. Returns `"<encrypted>"` regardless
   *  of input shape. */
  redact(_stored: string | null | undefined): string {
    return "<encrypted>";
  }
}
