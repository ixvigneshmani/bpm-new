const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  Draft: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
  Active: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  Pending: { bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-400" },
  Review: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
};

export default function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.Draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}
