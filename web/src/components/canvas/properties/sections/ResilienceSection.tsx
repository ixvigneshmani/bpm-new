/* ─── Resilience Section ──────────────────────────────────────────────
 * Service Task resilience configuration:
 * Retry policy, timeout, circuit breaker, idempotency key.
 *
 * Refactored Session 2: Tailwind classes were silently no-op'ing inside
 * `.props-panel` (preflight disabled). Now uses shared inline tokens.
 * Circuit breaker + idempotency key are design-only at runtime — flagged
 * with a single DesignOnlyBanner above the group.
 * ──────────────────────────────────────────────────────────────────── */

import type { ResilienceConfig } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";
import {
  configBox,
  hintStyle,
  inputStyle,
  labelStyle,
  numericInput,
  sectionStack,
  subLabelStyle,
  tokenInput,
  twoColumnGrid,
} from "../styles";
import DesignOnlyBanner from "../banners/DesignOnlyBanner";

type Props = {
  resilience: ResilienceConfig | undefined;
  onChange: (r: ResilienceConfig) => void;
};

export default function ResilienceSection({ resilience = {}, onChange }: Props) {
  const retry = resilience.retry;
  const cb = resilience.circuitBreaker;

  return (
    <div style={sectionStack}>
      {/* Retry */}
      <div>
        <div style={labelStyle}>Retry Policy</div>
        <div style={configBox}>
          <div style={twoColumnGrid}>
            <div>
              <div style={subLabelStyle}>Retries</div>
              <input
                type="number"
                min={0}
                max={10}
                value={retry?.count ?? 3}
                onChange={(e) =>
                  onChange({
                    ...resilience,
                    retry: {
                      count: parseInt(e.target.value, 10) || 0,
                      backoff: retry?.backoff || "exponential",
                      delay: retry?.delay || "PT10S",
                    },
                  })
                }
                style={numericInput}
              />
            </div>
            <div>
              <div style={subLabelStyle}>Backoff</div>
              <select
                value={retry?.backoff || "exponential"}
                onChange={(e) =>
                  onChange({
                    ...resilience,
                    retry: {
                      count: retry?.count ?? 3,
                      backoff: e.target.value as "fixed" | "exponential",
                      delay: retry?.delay || "PT10S",
                    },
                  })
                }
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                <option value="fixed">Fixed</option>
                <option value="exponential">Exponential</option>
              </select>
            </div>
          </div>
          <div>
            <div style={subLabelStyle}>Delay between retries</div>
            <input
              type="text"
              value={retry?.delay || ""}
              onChange={(e) =>
                onChange({
                  ...resilience,
                  retry: {
                    count: retry?.count ?? 3,
                    backoff: retry?.backoff || "exponential",
                    delay: e.target.value,
                  },
                })
              }
              style={tokenInput}
              placeholder="PT10S"
            />
            <div style={hintStyle}>ISO-8601 duration. PT10S = 10 seconds, PT2M = 2 minutes.</div>
          </div>
        </div>
      </div>

      {/* Timeout */}
      <div>
        <div style={labelStyle}>Timeout</div>
        <input
          type="text"
          value={resilience.timeout || ""}
          onChange={(e) => onChange({ ...resilience, timeout: e.target.value })}
          style={tokenInput}
          placeholder="PT30S"
        />
        <div style={hintStyle}>Maximum time the worker has to complete before the engine fails the job.</div>
      </div>

      {/* Circuit Breaker (design-only) */}
      <div>
        <div style={labelStyle}>Circuit Breaker</div>
        <DesignOnlyBanner milestone="E8">
          Saves with the canvas; engine doesn't enforce circuit-breaker
          state yet — ships with the event-semantics milestone.
        </DesignOnlyBanner>
        <div style={configBox}>
          <div style={twoColumnGrid}>
            <div>
              <div style={subLabelStyle}>Failure threshold</div>
              <input
                type="number"
                min={1}
                max={100}
                value={cb?.failureThreshold ?? 5}
                onChange={(e) =>
                  onChange({
                    ...resilience,
                    circuitBreaker: {
                      failureThreshold: parseInt(e.target.value, 10) || 5,
                      resetTimeout: cb?.resetTimeout || "PT60S",
                    },
                  })
                }
                style={numericInput}
              />
            </div>
            <div>
              <div style={subLabelStyle}>Reset timeout</div>
              <input
                type="text"
                value={cb?.resetTimeout || ""}
                onChange={(e) =>
                  onChange({
                    ...resilience,
                    circuitBreaker: {
                      failureThreshold: cb?.failureThreshold ?? 5,
                      resetTimeout: e.target.value,
                    },
                  })
                }
                style={tokenInput}
                placeholder="PT60S"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Idempotency Key (design-only) */}
      <div>
        <div style={labelStyle}>Idempotency Key</div>
        <DesignOnlyBanner milestone="E8">
          The engine doesn't yet read this key to deduplicate worker
          jobs — ships with the event-semantics milestone.
        </DesignOnlyBanner>
        <FeelExpressionInput
          value={resilience.idempotencyKey || ""}
          onChange={(v) => onChange({ ...resilience, idempotencyKey: v })}
          placeholder='= concat(order.id, "-", task.retryCount)'
          showAiAssist={false}
        />
      </div>
    </div>
  );
}
