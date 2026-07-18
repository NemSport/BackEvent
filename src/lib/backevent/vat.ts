export const danishVatRate = 0.25;

export function amountIncludingVat(value: number, alreadyIncludesVat: boolean) {
  const amount = alreadyIncludesVat ? value : value * (1 + danishVatRate);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
