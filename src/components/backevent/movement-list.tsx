import { ArrowRight } from "lucide-react";
import { formatPlainQuantity, formatStockQuantity } from "@/lib/backevent/quantity-format";
import { getLocation, getProduct, locations as mockLocations, products as mockProducts } from "@/lib/backevent/mock-data";
import type { Location, Product, StockMovement } from "@/lib/backevent/types";
import { cn, StatusPill } from "./ui";

export function MovementList({
  movements,
  locations = mockLocations,
  products = mockProducts,
}: {
  movements: StockMovement[];
  locations?: Location[];
  products?: Product[];
}) {
  return (
    <div className="space-y-3">
      {movements.map((movement) => {
        const product = products.find((item) => item.id === movement.productId) ?? getProduct(movement.productId);
        const from = locations.find((item) => item.id === movement.fromLocationId) ?? getLocation(movement.fromLocationId);
        const to = locations.find((item) => item.id === movement.toLocationId) ?? getLocation(movement.toLocationId);
        const isReversed = Boolean(movement.reversedAt);

        return (
          <article
            key={movement.id}
            className={cn("rounded-2xl border p-4 shadow-sm", isReversed ? "border-line bg-soft opacity-80" : "border-line bg-macro")}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-ink">
                  {product ? formatStockQuantity(movement.quantity, product) : formatPlainQuantity(movement.quantity, movement.unit)} {product?.name}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium text-muted">
                  {from?.name}
                  <ArrowRight className="h-4 w-4 text-pantone140" aria-hidden />
                  {to?.name}
                </p>
                {isReversed ? <StatusPill tone="danger" className="mt-2">Fortrudt</StatusPill> : null}
              </div>
              <div className="shrink-0 text-right text-sm font-bold text-pantone140">
                <p>{movement.createdBy}</p>
                {movement.performedByType === "guest" ? <p className="mt-1 text-xs text-muted">Gæst / manuel registrering</p> : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
