import Link from "next/link";
import { MapPin } from "lucide-react";
import { getFillPercentage, getLocationTotal, getStockStatus } from "@/lib/backevent/mock-data";
import type { Location, StockStatus } from "@/lib/backevent/types";
import { StatusBadge } from "./status-badge";
import { cn } from "./ui";

export function LocationCard({
  location,
  href,
  selected = false,
  total,
  status,
  fill,
}: {
  location: Location;
  href?: string;
  selected?: boolean;
  total?: number;
  status?: StockStatus;
  fill?: number;
}) {
  const displayedTotal = total ?? getLocationTotal(location.id);
  const displayedStatus = status ?? getStockStatus(location.id);
  const displayedFill = fill ?? getFillPercentage(location.id);
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              selected ? "bg-macro/15 text-macro" : "bg-pantone139/25 text-pantone140",
            )}
          >
            <MapPin className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h3 className="text-lg font-bold">{location.name}</h3>
            <p className={cn("mt-1 text-sm font-medium", selected ? "text-macro/80" : "text-muted")}>
              {displayedTotal.toLocaleString("da-DK")} kasser i alt
            </p>
          </div>
        </div>
        {!selected ? <StatusBadge status={displayedStatus} /> : null}
      </div>
      <div className="mt-5">
        <div className={cn("mb-2 flex justify-between text-sm font-bold", selected ? "text-macro/85" : "text-muted")}>
          <span>Fyldt</span>
          <span>{displayedFill}%</span>
        </div>
        <div className={cn("h-2.5 overflow-hidden rounded-full", selected ? "bg-macro/20" : "bg-soft")}>
          <div
            className={cn("h-full rounded-full", displayedStatus === "critical" ? "bg-warmRed" : "bg-pantone139")}
            style={{ width: `${displayedFill}%` }}
          />
        </div>
      </div>
    </>
  );

  const classes = cn(
    "block rounded-2xl border p-4 shadow-sm transition md:p-5",
    selected ? "border-pantone140 bg-pantone140 text-macro" : "border-line bg-macro text-ink hover:border-pantone139 hover:bg-soft/70",
  );

  return href ? (
    <Link href={href} className={classes}>
      {content}
    </Link>
  ) : (
    <article className={classes}>{content}</article>
  );
}
