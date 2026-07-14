export type ReturnControlCaseType = "return" | "receipt-control";

export function buildReturnControlDetailHref(type: ReturnControlCaseType, id: string) {
  return type === "receipt-control" ? `/retur/kontrol/${id}` : `/retur/${id}`;
}

export function buildOpenReturnControlSummary(openReturns: number | null, openReceiptControls: number | null) {
  const returns = openReturns ?? 0;
  const receiptControls = openReceiptControls ?? 0;
  return { openReturns: returns, openReceiptControls: receiptControls, openTotal: returns + receiptControls };
}

const STATUS_LABELS: Record<string, string> = {
  open: "Afventer kontrol",
  follow_up: "Kræver opfølgning",
  approved: "Godkendt",
  confirmed_error: "Fejl bekræftet",
  resolved: "Godkendt",
  dismissed: "Fejl bekræftet",
  test: "Test",
};

export const ACTIVE_RECEIPT_CONTROL_STATUSES = ["open", "follow_up"] as const;
export const CLOSED_RECEIPT_CONTROL_STATUSES = ["approved", "confirmed_error", "resolved", "dismissed"] as const;
export type ReceiptControlAction = "approve" | "follow_up" | "confirm_error" | "save_note";

export function canTreatReceiptControl(isOwner: boolean, financeGroup: boolean) {
  return isOwner || financeGroup;
}

export function receiptControlStatusForAction(action: ReceiptControlAction, currentStatus: string) {
  if (action === "approve") return "approved";
  if (action === "follow_up") return "follow_up";
  if (action === "confirm_error") return "confirmed_error";
  return currentStatus;
}

export function isActiveReceiptControlStatus(status: string) {
  return (ACTIVE_RECEIPT_CONTROL_STATUSES as readonly string[]).includes(status);
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  sale_with_deposit_return: "Salg med pantretur",
  return_receipt: "Returbon",
  regular_sale: "Almindeligt salg",
  manual_review: "Kræver manuel kontrol",
};

const RULE_LABELS: Record<string, string> = {
  RETURN_RECEIPT: "Returbon",
  HIGH_DEPOSIT_RETURN: "Mange pantgenstande",
  NEGATIVE_RECEIPT_TOTAL: "Negativ bontotal",
  MANUAL_REVIEW: "Manuel kontrol",
};

export function formatReceiptControlStatus(value: string) {
  return STATUS_LABELS[value] ?? "Ukendt status";
}

export function formatReceiptClassification(value: string) {
  return CLASSIFICATION_LABELS[value] ?? "Anden bontype";
}

export function formatReceiptControlRule(value: string) {
  return RULE_LABELS[value] ?? "Anden kontrolregel";
}

export function explainReceiptControlRule(value: string, depositQuantity = 0) {
  const explanations: Record<string, string> = {
    RETURN_RECEIPT: "Bonen er registreret som en returbon og skal derfor kontrolleres.",
    HIGH_DEPOSIT_RETURN: `Der er registreret ${formatNumber(depositQuantity)} pantgenstande på samme bon. Grænsen er 10.`,
    NEGATIVE_RECEIPT_TOTAL: "Bonens samlede beløb er negativt, fordi returbeløbet overstiger købet.",
    MANUAL_REVIEW: "Bonen indeholder oplysninger, som kræver en manuel vurdering.",
  };
  return explanations[value] ?? "Bonen er markeret af en intern kontrolregel.";
}

function formatNumber(value: number) {
  return Number(value).toLocaleString("da-DK");
}
