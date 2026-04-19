/* ─── PoolSection ────────────────────────────────────────────────────
 * Pool (bpmn:Participant) properties: participant name, orientation.
 * ──────────────────────────────────────────────────────────────────── */

export type PoolSectionProps = {
  participantName: string;
  onParticipantNameChange: (v: string) => void;
  isHorizontal: boolean;
  onIsHorizontalChange: (v: boolean) => void;
};

export default function PoolSection(props: PoolSectionProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Participant Name
        </label>
        <input
          type="text"
          value={props.participantName}
          onChange={(e) => props.onParticipantNameChange(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-50"
          placeholder="e.g. Customer"
        />
        <div className="mt-1 text-[10px] text-gray-500">
          Written to <code>bpmn:Participant@name</code>. Shown on the pool's left band.
        </div>
      </div>

      <label className="flex items-start gap-2 text-[12px] text-gray-700">
        <input
          type="checkbox"
          checked={props.isHorizontal}
          onChange={(e) => props.onIsHorizontalChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="font-medium">Horizontal orientation</span>
          <span className="block text-[10px] text-gray-500">
            Lanes stack vertically inside the pool. Vertical pools aren't rendered yet — toggle
            only affects the BPMN DI <code>isHorizontal</code> attribute on export.
          </span>
        </span>
      </label>
    </div>
  );
}
