export type OnlinePosReceiptClassification =
  | "return_receipt"
  | "sale_with_deposit_return"
  | "sale"
  | "void"
  | "uncertain";

export type OnlinePosReceiptControlType =
  | "RETURN_RECEIPT"
  | "HIGH_DEPOSIT_RETURN"
  | "NEGATIVE_RECEIPT_TOTAL"
  | "MANUAL_REVIEW";

export type OnlinePosReceiptControlLine = {
  productName: string | null;
  lineType: string;
  quantity: number;
  amount: number;
  amountIncludingVat?: number;
  amountSource?: string;
};

export type OnlinePosReceiptControlInput = {
  venueId?: string | null;
  transactionId?: string | null;
  receiptNumber?: string | null;
  transactionType?: string | null;
  transactionStatus?: string | null;
  returnId?: string | null;
  refundId?: string | null;
  total?: number | null;
  totalIncludingVat?: number | null;
  totalSource?: string | null;
  cashRegisterId?: string | null;
  cashRegisterName?: string | null;
  transactionDatetime?: string | null;
  amountsIncludeVat?: boolean;
  lines: OnlinePosReceiptControlLine[];
};

export type OnlinePosReceiptControlAnalysis = {
  receiptKey: string;
  transactionId: string | null;
  receiptNumber: string | null;
  cashRegisterId: string | null;
  cashRegisterName: string | null;
  transactionDatetime: string | null;
  amountsIncludeVat: boolean;
  amountSourceDetails: {
    purchase: string[];
    depositReturn: string[];
    finalTotal: string;
  };
  classification: OnlinePosReceiptClassification;
  classificationLabel: string;
  signals: string[];
  controlTypes: OnlinePosReceiptControlType[];
  depositReturnQuantity: number;
  depositBreakdown: { cups: number; pitchers: number; other: number };
  purchaseValue: number;
  depositReturnValue: number;
  finalTotal: number;
  purchaseValueIncludingVat: number;
  depositReturnValueIncludingVat: number;
  finalTotalIncludingVat: number;
};

export const onlinePosDepositControlThreshold = 10;

export function analyzeOnlinePosReceipt(
  input: OnlinePosReceiptControlInput,
  depositThreshold = onlinePosDepositControlThreshold,
): OnlinePosReceiptControlAnalysis {
  const header = `${input.transactionType ?? ""} ${input.transactionStatus ?? ""}`.trim().toLocaleLowerCase("da-DK");
  const explicitReturn = Boolean(input.returnId || input.refundId || /(^|\s)(return|refund|retur|credit)(\s|$)/.test(header));
  const voidSignal = /void|cancel|cancelled|canceled|annuller/.test(header);
  const depositLines = input.lines.filter((line) => line.lineType === "deposit_return");
  const negativeOrdinaryLines = input.lines.filter((line) =>
    line.lineType !== "deposit_return" && line.lineType !== "deposit_fee" && (line.quantity < 0 || line.amount < 0),
  );
  const depositBreakdown = depositLines.reduce(
    (sum, line) => {
      const quantity = Math.abs(line.quantity);
      const name = (line.productName ?? "").toLocaleUpperCase("da-DK");
      if (name.includes("KRUS")) sum.cups += quantity;
      else if (name.includes("KANDE")) sum.pitchers += quantity;
      else sum.other += quantity;
      return sum;
    },
    { cups: 0, pitchers: 0, other: 0 },
  );
  const depositReturnQuantity = roundNumber(depositBreakdown.cups + depositBreakdown.pitchers + depositBreakdown.other);
  const purchaseLines = input.lines
    .filter((line) => line.lineType !== "deposit_return" && line.lineType !== "deposit_fee" && line.amount > 0);
  const returnedDepositLines = depositLines.filter((line) => line.amount < 0);
  const purchaseValue = roundNumber(purchaseLines.reduce((sum, line) => sum + line.amount, 0));
  const depositReturnValue = roundNumber(returnedDepositLines.reduce((sum, line) => sum + Math.abs(line.amount), 0));
  const calculatedTotal = roundNumber(input.lines.reduce((sum, line) => sum + line.amount, 0));
  const finalTotal = roundNumber(input.total ?? calculatedTotal);
  const purchaseValueIncludingVat = roundNumber(purchaseLines
    .reduce((sum, line) => sum + (line.amountIncludingVat ?? line.amount), 0));
  const depositReturnValueIncludingVat = roundNumber(returnedDepositLines
    .reduce((sum, line) => sum + Math.abs(line.amountIncludingVat ?? line.amount), 0));
  const calculatedTotalIncludingVat = roundNumber(input.lines
    .reduce((sum, line) => sum + (line.amountIncludingVat ?? line.amount), 0));
  const finalTotalIncludingVat = roundNumber(input.totalIncludingVat ?? input.total ?? calculatedTotalIncludingVat);

  let classification: OnlinePosReceiptClassification;
  if (voidSignal) classification = "void";
  else if (explicitReturn) classification = "return_receipt";
  else if (negativeOrdinaryLines.length > 0) classification = "uncertain";
  else if (depositReturnQuantity > 0) classification = "sale_with_deposit_return";
  else classification = "sale";

  const signals: string[] = [];
  if (explicitReturn) signals.push("explicit_return_header");
  if (voidSignal) signals.push("void_signal");
  if (negativeOrdinaryLines.length > 0 && !explicitReturn) signals.push("negative_product_line_without_return_header");
  if (depositReturnQuantity > 0) signals.push("deposit_return_lines");
  if (finalTotal < 0) signals.push("negative_receipt_total");

  const controlTypes: OnlinePosReceiptControlType[] = [];
  if (classification === "return_receipt") controlTypes.push("RETURN_RECEIPT");
  if (depositReturnQuantity > depositThreshold) controlTypes.push("HIGH_DEPOSIT_RETURN");
  if ((classification === "sale" || classification === "sale_with_deposit_return") && finalTotal < 0) {
    controlTypes.push("NEGATIVE_RECEIPT_TOTAL");
  }
  if (classification === "uncertain") controlTypes.push("MANUAL_REVIEW");

  return {
    receiptKey: buildOnlinePosReceiptKey(input),
    transactionId: input.transactionId ?? null,
    receiptNumber: input.receiptNumber ?? null,
    cashRegisterId: input.cashRegisterId ?? null,
    cashRegisterName: input.cashRegisterName ?? null,
    transactionDatetime: input.transactionDatetime ?? null,
    amountsIncludeVat: input.amountsIncludeVat ?? true,
    amountSourceDetails: {
      purchase: uniqueSources(purchaseLines),
      depositReturn: uniqueSources(returnedDepositLines),
      finalTotal: input.totalSource ?? (input.total === null || input.total === undefined ? "calculated_from_lines" : "input_total"),
    },
    classification,
    classificationLabel: receiptClassificationLabel(classification),
    signals,
    controlTypes,
    depositReturnQuantity,
    depositBreakdown,
    purchaseValue,
    depositReturnValue,
    finalTotal,
    purchaseValueIncludingVat,
    depositReturnValueIncludingVat,
    finalTotalIncludingVat,
  };
}

export function buildOnlinePosReceiptKey(input: Pick<OnlinePosReceiptControlInput, "venueId" | "transactionId" | "receiptNumber">) {
  return [
    "onlinepos-receipt",
    normalizeKeyPart(input.venueId) ?? "venue",
    normalizeKeyPart(input.transactionId) ?? "transaction",
    normalizeKeyPart(input.receiptNumber) ?? "receipt",
  ].join(":");
}

export function buildOnlinePosReceiptControlKey(receiptKey: string, controlType: OnlinePosReceiptControlType) {
  return `${receiptKey}:control:${controlType.toLocaleLowerCase("en-US")}`;
}

export function receiptClassificationLabel(classification: OnlinePosReceiptClassification) {
  if (classification === "return_receipt") return "Egentlig returbon";
  if (classification === "sale_with_deposit_return") return "Almindeligt salg med pantretur";
  if (classification === "void") return "Annulleret/void";
  if (classification === "uncertain") return "Manuel kontrol";
  return "Almindeligt salg";
}

function normalizeKeyPart(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/[^a-z0-9æøå._-]+/g, "-").replace(/^-|-$/g, "") || null;
}

function uniqueSources(lines: OnlinePosReceiptControlLine[]) {
  return [...new Set(lines.map((line) => line.amountSource ?? "input_line"))];
}

function roundNumber(value: number) {
  return Math.round(value * 1000) / 1000;
}
