/* ─── noop connector ─────────────────────────────────────────────────
 * The trivially-trivial connector. Empty connectionSchema, one
 * operation `echo` that returns whatever input it received. Exists so
 * the framework has a registered connector for unit/integration tests
 * without depending on a real external service (SMTP relay, HTTP
 * server, etc.).
 *
 * Sprint 1 acceptance uses this to prove the whole stack — registry,
 * instance service, dispatcher, engine routing — works end-to-end.
 * Sprint 2 replaces mail's standalone module with a real connector,
 * but noop stays as a permanent demo / test fixture.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  ConnectorRegistry,
  type ConnectorDefinition,
} from "../connector-registry";

const NOOP_CONNECTOR: ConnectorDefinition = {
  id: "noop",
  name: "Noop",
  description:
    "Test fixture connector. Returns whatever it was sent. Useful for QA and smoke tests; do not use in real processes.",
  connectionSchema: {},
  secretFields: [],
  // Test fixture; no connection setup needed to use it.
  connectionRequired: false,
  operations: [
    {
      id: "echo",
      name: "Echo",
      description: "Returns the input verbatim, plus a timestamp marker.",
      inputSchema: {
        message: {
          type: "string",
          description: "Any string. Returned in the output as `echoed`.",
        },
      },
      outputKeys: ["echoed", "echoedAt"],
      handler: async (_ctx, _cfg, input) => ({
        echoed: input.message ?? null,
        echoedAt: new Date().toISOString(),
      }),
    },
  ],
};

@Injectable()
export class NoopConnector implements OnModuleInit {
  constructor(private readonly registry: ConnectorRegistry) {}
  onModuleInit(): void {
    this.registry.register(NOOP_CONNECTOR);
  }
}
