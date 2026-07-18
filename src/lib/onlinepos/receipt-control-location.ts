export type ReceiptControlLocationDisplayInput = {
  locationName?: string | null;
  cashRegisterName?: string | null;
  cashRegisterId?: string | null;
};

export function formatReceiptControlLocation(input: ReceiptControlLocationDisplayInput) {
  const locationName = clean(input.locationName);
  if (locationName) return `Bar: ${locationName}`;

  const onlinePosReference = clean(input.cashRegisterName) ?? clean(input.cashRegisterId);
  return onlinePosReference
    ? `Bar: ${onlinePosReference} · Ikke mappet`
    : "Bar: Ukendt · Ikke mappet";
}

function clean(value: string | null | undefined) {
  return value?.trim() || null;
}
