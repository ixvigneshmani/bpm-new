/* ─── Resilience Section ──────────────────────────────────────────────
 * Service Task resilience configuration:
 * Retry policy, timeout, circuit breaker, idempotency key.
 * ──────────────────────────────────────────────────────────────────── */

import type { ResilienceConfig } from "../../../../types/bpmn-node-data";
import FeelExpressionInput from "../fields/FeelExpressionInput";

type Props = {
  resilience: ResilienceConfig | undefined;
  onChange: (r: ResilienceConfig) => void;
};

export default function ResilienceSection({ resilience = {}, onChange }: Props) {
  return (
    <div className="space-y-4">
      {/* Retry */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Retry Policy
        </div>
        <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[9px] font-medium text-gray-500">Retries</div>
              <input
                type="number"
                min={0}
                max={10}
                value={resilience.retry?.count ?? 3}
                onChange={(e) => onChange({ ...resilience, retry: { ...resilience.retry!, count: parseInt(e.target.value) || 0, backoff: resilience.retry?.backoff || "exponential", delay: resilience.retry?.delay || "PT10S" } })}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
              />
            </div>
            <div>
              <div className="mb-1 text-[9px] font-medium text-gray-500">Backoff</div>
              <select
                value={resilience.retry?.backoff || "exponential"}
                onChange={(e) => onChange({ ...resilience, retry: { ...resilience.retry!, backoff: e.target.value as "fixed" | "exponential", count: resilience.retry?.count ?? 3, delay: resilience.retry?.delay || "PT10S" } })}
                className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
              >
                <option value="fixed">Fixed</option>
                <option value="exponential">Exponential</option>
              </select>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[9px] font-medium text-gray-500">Delay</div>
            <input
              type="text"
              value={resilience.retry?.delay || ""}
              onChange={(e) => onChange({ ...resilience, retry: { ...resilience.retry!, delay: e.target.value, count: resilience.retry?.count ?? 3, backoff: resilience.retry?.backoff || "exponential" } })}
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 font-mono text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
              placeholder="PT10S (10 seconds)"
            />
          </div>
        </div>
      </div>

      {/* Timeout */}
      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Timeout
        </div>
        <input
          type="text"
          value={resilience.timeout || ""}
          onChange={(e) => onChange({ ...resilience, timeout: e.target.value })}
          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-[12px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-2 focus:ring-brand-50"
          placeholder="PT30S (30 seconds)"
        />
      </div>

      {/* Circuit Breaker (extension) */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Circuit Breaker
          </span>
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-brand-600">
            Extension
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div>
            <div className="mb-1 text-[9px] font-medium text-gray-500">Failure Threshold</div>
            <input
              type="number"
              min={1}
              max={100}
              value={resilience.circuitBreaker?.failureThreshold ?? 5}
              onChange={(e) => onChange({ ...resilience, circuitBreaker: { failureThreshold: parseInt(e.target.value) || 5, resetTimeout: resilience.circuitBreaker?.resetTimeout || "PT60S" } })}
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
            />
          </div>
          <div>
            <div className="mb-1 text-[9px] font-medium text-gray-500">Reset Timeout</div>
            <input
              type="text"
              value={resilience.circuitBreaker?.resetTimeout || ""}
              onChange={(e) => onChange({ ...resilience, circuitBreaker: { failureThreshold: resilience.circuitBreaker?.failureThreshold ?? 5, resetTimeout: e.target.value } })}
              className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 font-mono text-[11px] text-gray-900 outline-none transition-all focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
              placeholder="PT60S"
            />
          </div>
        </div>
      </div>

      {/* Idempotency Key (extension) */}
      <div>
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Idempotency Key
          </span>
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-brand-600">
            Extension
          </span>
        </div>
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
