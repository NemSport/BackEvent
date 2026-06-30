import type { StockStatus } from "@/lib/backevent/types";

const statusCopy: Record<StockStatus, string> = {
  good: "Godt lager",
  low: "Lavt lager",
  critical: "Kritisk lavt",
};

const statusClasses: Record<StockStatus, string> = {
  good: "bg-green-50 text-ok border-green-100",
  low: "bg-pantone139/25 text-pantone140 border-pantone139/60",
  critical: "bg-warmRed/10 text-warmRed border-warmRed/25",
};

export function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-bold ${statusClasses[status]}`}
    >
      {statusCopy[status]}
    </span>
  );
}
