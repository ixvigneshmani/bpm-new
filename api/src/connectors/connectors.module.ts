import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EngineModule } from "../engine/engine.module";
import { ConnectorDispatcherService } from "./connector-dispatcher.service";
import { ConnectorInstancesService } from "./connector-instances.service";
import { ConnectorRegistry } from "./connector-registry";
import { ConnectorsController } from "./connectors.controller";
import { MailConnector } from "./connectors/mail.connector";
import { NoopConnector } from "./connectors/noop.connector";
import { RestConnector } from "./connectors/rest.connector";
import { NotifyEmailLegacyShim } from "./legacy/notify-email-shim";

/** I4 — Connector framework. Owns:
 *   • ConnectorRegistry (catalog of definitions)
 *   • ConnectorInstancesService (DB CRUD over CONNECTOR_INSTANCES with
 *     CryptoService-driven secret encryption)
 *   • ConnectorDispatcherService (routes serviceTask `type=connector`
 *     to the right operation via the engine's service-task topic)
 *   • One built-in test fixture connector (Noop). Real connectors
 *     (Mail, REST, …) register here in subsequent sprints.
 *
 *  Imports EngineModule so the dispatcher can grab ServiceTaskRegistry;
 *  AuthModule for the JwtAuthGuard on the controller.
 */
@Module({
  imports: [AuthModule, EngineModule],
  controllers: [ConnectorsController],
  providers: [
    ConnectorRegistry,
    ConnectorInstancesService,
    ConnectorDispatcherService,
    NoopConnector,
    MailConnector,
    RestConnector,
    NotifyEmailLegacyShim,
  ],
  exports: [ConnectorRegistry, ConnectorInstancesService],
})
export class ConnectorsModule {}
