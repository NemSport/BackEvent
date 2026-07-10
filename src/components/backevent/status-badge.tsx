import type { StockStatus } from "@/lib/backevent/types";
import { StatusPill } from "./ui";

const statusCopy: Record<StockStatus, string> = {
  good: "Godt lager",
  low: "Lavt lager",
  critical: "Kritisk lavt",
};

const statusTone: Record<StockStatus, "success" | "pending" | "danger"> = {
  good: "success",
  low: "pending",
  critical: "danger",
};

export function StatusBadge({ status }: { status: StockStatus }) {
  return <StatusPill tone={statusTone[status]}>{statusCopy[status]}</StatusPill>;
}
