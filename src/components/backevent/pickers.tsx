"use client";

import { Check, Minus, Package, Plus } from "lucide-react";
import type { Location, Product } from "@/lib/backevent/types";

export function LocationPicker({
  locations,
  selectedId,
  onSelect,
  columns = "locations",
  testIdPrefix = "location",
}: {
  locations: Location[];
  selectedId?: string;
  onSelect: (id: string) => void;
  columns?: "locations" | "compact";
  testIdPrefix?: string;
}) {
  return (
    <div className={`grid gap-3 ${columns === "compact" ? "sm:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
      {locations.map((location) => {
        const selected = location.id === selectedId;

        return (
          <button
            key={location.id}
            type="button"
            data-testid={`${testIdPrefix}-${location.id}`}
            onClick={() => onSelect(location.id)}
            className={`group flex min-h-24 items-center justify-between gap-3 rounded-[1.5rem] border-2 p-4 text-left text-lg font-bold transition ${
              selected
                ? "border-pantone140 bg-pantone139 text-ink shadow-soft"
                : "border-transparent bg-soft text-ink hover:border-pantone139 hover:bg-macro"
            }`}
          >
            <span>{location.name}</span>
            {selected ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pantone140 px-3 py-1 text-sm font-bold text-macro">
                <Check className="h-4 w-4" aria-hidden />
                Valgt
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function ProductPicker({
  products,
  selectedId,
  onSelect,
}: {
  products: Product[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {products.map((product) => {
        const selected = product.id === selectedId;

        return (
          <button
            key={product.id}
            type="button"
            data-testid={`product-${product.id}`}
            onClick={() => onSelect(product.id)}
            className={`flex min-h-28 flex-col items-start justify-between gap-4 rounded-[1.5rem] border-2 p-4 text-left text-lg font-bold transition ${
              selected
                ? "border-pantone140 bg-pantone139 text-ink shadow-soft"
                : "border-transparent bg-soft text-ink hover:border-pantone139 hover:bg-macro"
            }`}
          >
            <span className="flex w-full items-center justify-between gap-3">
              <Package className="h-6 w-6 text-pantone140" aria-hidden />
              {selected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-pantone140 px-3 py-1 text-sm font-bold text-macro">
                  <Check className="h-4 w-4" aria-hidden />
                  Valgt
                </span>
              ) : null}
            </span>
            <span>{product.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function QuantityControl({
  value,
  onChange,
  unit = "kasser",
}: {
  value: number;
  onChange: (value: number) => void;
  unit?: string;
}) {
  const update = (change: number) => onChange(Math.max(0.5, Number((value + change).toFixed(1))));

  return (
    <div className="rounded-[1.75rem] bg-soft p-4">
      <div className="flex items-center justify-center rounded-[1.5rem] bg-macro px-4 py-8 text-center shadow-sm">
        <p className="text-5xl font-bold text-ink sm:text-6xl">
          {value.toLocaleString("da-DK")}
          <span className="ml-2 text-2xl text-pantone140">{unit}</span>
        </p>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
        <QuantityButton testId="quantity-minus-1" onClick={() => update(-1)}>
          -1
        </QuantityButton>
        <QuantityButton testId="quantity-minus-half" onClick={() => update(-0.5)}>
          -½
        </QuantityButton>
        <QuantityButton testId="quantity-plus-half" onClick={() => update(0.5)} strong>
          +½
        </QuantityButton>
        <QuantityButton testId="quantity-plus-1" onClick={() => update(1)} strong>
          +1
        </QuantityButton>
      </div>
    </div>
  );
}

function QuantityButton({
  children,
  onClick,
  testId,
  strong = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId: string;
  strong?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`min-h-14 rounded-2xl px-2 py-3 text-xl font-bold shadow-sm ${
        strong ? "bg-pantone139 text-pantone140" : "bg-macro text-pantone140"
      }`}
    >
      {children}
    </button>
  );
}

export function ProductStepper({
  product,
  value,
  onChange,
}: {
  product: Product;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-3xl border border-line bg-macro p-3 shadow-sm">
      <div className="min-w-0">
        <p className="text-lg font-bold text-ink">{product.name}</p>
        <p className="text-sm font-bold text-muted">{product.unit}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Fjern ${product.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-soft text-pantone140"
        >
          <Minus className="h-5 w-5" aria-hidden />
        </button>
        <span className="w-12 text-center text-2xl font-bold text-ink">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          aria-label={`Tilføj ${product.name}`}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-pantone139 text-pantone140"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
