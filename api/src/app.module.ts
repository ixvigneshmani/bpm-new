import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { CryptoModule } from "./common/crypto/crypto.module";
import { DatabaseModule } from "./database/database.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { ProcessesModule } from "./processes/processes.module";
import { AiModule } from "./ai/ai.module";
import { ConnectorsModule } from "./connectors/connectors.module";
import { EngineModule } from "./engine/engine.module";
import { RolesModule } from "./roles/roles.module";
import { VersionController } from "./common/version.controller";
import { CorrelationContext } from "./common/observability/correlation-context";

const env = process.env.NODE_ENV || "development";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${env}`,
    }),
    // OS4 — Structured logging + correlation IDs. nestjs-pino wraps the
    // NestJS Logger interface so all existing `Logger.log/.warn/.error`
    // calls flow through pino. JSON output in production, pretty-print
    // in dev. The genReqId hook also seeds CorrelationContext for the
    // life of the request so engine code can grab the id from anywhere.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || (env === "production" ? "info" : "debug"),
        // OS4 / H4 — never persist secrets to logs. pino replaces matched
        // paths with "[Redacted]" in the serialized output. Covers
        // login bodies, refresh tokens, password-change payloads,
        // bearer Authorization headers, and Cookie headers. Add more
        // paths here as new auth surfaces appear.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-acting-for"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.refreshToken',
            'req.body.token',
            'req.body.code',
            'res.headers["set-cookie"]',
          ],
          censor: '[Redacted]',
        },
        transport:
          env === "production"
            ? undefined
            : {
                target: "pino-pretty",
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: "HH:MM:ss.l",
                  ignore: "pid,hostname,req.headers,res.headers",
                },
              },
        // Fastify owns the request id (see FastifyAdapter.genReqId in
        // main.ts). pino picks it up via the default req.id mapping.
        customProps: (req) => {
          // The Fastify request is available; AuthMiddleware enriches
          // CorrelationContext with tenantId/userId post-JWT-verify, so
          // those fields land here naturally on subsequent log lines.
          const ctx = CorrelationContext.get();
          return ctx
            ? {
                correlationId: ctx.correlationId,
                tenantId: ctx.tenantId,
                userId: ctx.userId,
              }
            : { correlationId: (req as { id?: string }).id };
        },
        // Trim verbose default serializers so dev logs stay readable.
        serializers: {
          req: (req: { method?: string; url?: string; id?: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url,
          }),
          res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
        },
      },
    }),
    CryptoModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    ProcessesModule,
    AiModule,
    EngineModule,
    ConnectorsModule,
    RolesModule,
  ],
  controllers: [VersionController],
})
export class AppModule {}
