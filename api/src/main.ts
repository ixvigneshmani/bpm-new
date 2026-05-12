import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger, PinoLogger } from "nestjs-pino";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./common/filters/http-exception.filter";
import { CorrelationContext } from "./common/observability/correlation-context";
import { initSentry } from "./common/observability/sentry";

const DEV_JWT_SECRET = "flowpro-dev-secret-key-change-in-production-min32";

function assertProductionConfig(config: ConfigService): void {
  if (config.get<string>("NODE_ENV") !== "production") return;

  const jwtSecret = config.get<string>("JWT_SECRET");
  if (!jwtSecret || jwtSecret === DEV_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error(
      "Refusing to boot in production: JWT_SECRET is missing, the dev placeholder, or shorter than 32 chars.",
    );
  }

  const corsOrigin = config.get<string>("CORS_ORIGIN");
  if (!corsOrigin || corsOrigin.split(",").some((o) => o.trim().includes("localhost"))) {
    throw new Error(
      "Refusing to boot in production: CORS_ORIGIN must not include any localhost entry.",
    );
  }

  // OS8 — ENCRYPTION_KEY required in prod. Reasserted here in addition
  // to the runtime check inside CryptoService.onModuleInit so we fail
  // before listen() rather than during the first secret operation.
  const encKey = config.get<string>("ENCRYPTION_KEY");
  if (!encKey || encKey.length !== 64 || !/^[0-9a-f]+$/i.test(encKey)) {
    throw new Error(
      "Refusing to boot in production: ENCRYPTION_KEY must be a 64-char hex string. " +
        "Generate via `openssl rand -hex 32`.",
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 5 * 1024 * 1024,
      // OS4 — accept upstream X-Request-Id for end-to-end tracing or
      // generate a UUIDv4 per request. Fastify owns req.id so this is
      // the canonical place to set it; pino-http and our ALS read it
      // downstream.
      genReqId: (req: { headers: Record<string, unknown> }) => {
        const header =
          (req.headers["x-request-id"] as string | undefined) ||
          (req.headers["x-correlation-id"] as string | undefined);
        return header ?? randomUUID();
      },
    }),
    { bufferLogs: true },
  );

  // Use pino as the application logger — replaces NestJS's default
  // console logger. Existing `Logger.log/.warn/.error` calls still
  // work; output now flows through pino with correlation metadata.
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  assertProductionConfig(config);

  // OS4 — Sentry init (no-op when SENTRY_DSN unset).
  initSentry({
    dsn: config.get<string>("SENTRY_DSN"),
    environment: config.get<string>("NODE_ENV") ?? "development",
    release: config.get<string>("APP_VERSION"),
  });

  // OS4 — bind a per-request correlation id to AsyncLocalStorage so
  // any service can read it via CorrelationContext.get() without
  // request-scoping the entire DI tree. The id is generated (or taken
  // from X-Request-Id) by nestjs-pino's genReqId hook.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (req, reply, done) => {
    const id = (req as { id?: string }).id ?? "unknown";
    CorrelationContext.enterWith({
      correlationId: id,
      route: `${req.method} ${req.url}`,
    });
    // Echo the correlation id on every response so a user with a
    // problem can paste it back to support and ops can grep logs.
    reply.header("X-Request-Id", id);
    done();
  });

  const port = config.get<number>("PORT", 3001);
  const corsOriginRaw = config.get<string>("CORS_ORIGIN", "http://localhost:5173");
  const allowedOrigins = corsOriginRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });

  app.enableCors({
    origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
    credentials: true,
    exposedHeaders: ["X-Request-Id"],
  });

  app.setGlobalPrefix("api");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(await app.resolve(PinoLogger)));

  app.enableShutdownHooks();

  await app.listen(port, "0.0.0.0");
  app.get(Logger).log(`FlowPro API running on http://localhost:${port}/api`, "Bootstrap");
}

bootstrap();
