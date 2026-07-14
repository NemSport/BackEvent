export type ReplayMode = "dry-run" | "test-run" | "replay";

export type HistoricalReplayWindowInput = {
  date: string;
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  overlapMinutes: number;
};

export type HistoricalReplayLineIdentity = {
  transactionId: string | null;
  receiptNumber: string | null;
  lineId: string | null;
  lineIndex: number;
  onlineposProductId: string | null;
  onlineposProductName: string | null;
};

export type ReplayWindow = {
  id: string;
  label: string;
  fetchFrom: string;
  fetchTo: string;
  displayFrom: string;
  displayTo: string;
};

export function isOnlinePosReplayEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.BACKEVENT_ENABLE_ONLINEPOS_REPLAY === "true";
}

export function buildReplayWindows(input: HistoricalReplayWindowInput): ReplayWindow[] {
  const start = parseCopenhagenLocal(input.date, input.startTime);
  const end = parseCopenhagenLocal(input.date, input.endTime);
  if (start >= end) throw new Error("Start skal være før slut");
  if (input.intervalMinutes <= 0) throw new Error("Interval skal være over 0");
  if (input.overlapMinutes < 0) throw new Error("Overlap må ikke være negativt");

  const windows: ReplayWindow[] = [];
  let windowStart = start;
  while (windowStart < end) {
    const windowEnd = new Date(Math.min(windowStart.getTime() + input.intervalMinutes * 60_000, end.getTime()));
    const fetchStart = new Date(windowStart.getTime() - input.overlapMinutes * 60_000);
    windows.push({
      id: `${formatLocalTime(windowEnd)}`,
      label: formatLocalTime(windowEnd),
      fetchFrom: fetchStart.toISOString(),
      fetchTo: windowEnd.toISOString(),
      displayFrom: formatLocalTime(windowStart),
      displayTo: formatLocalTime(windowEnd),
    });
    windowStart = windowEnd;
  }
  return windows;
}

export function replayExternalLineId(replayRunId: string, line: HistoricalReplayLineIdentity) {
  const transaction = line.transactionId ?? line.receiptNumber ?? "transaction";
  const lineId = line.lineId ?? `line-${line.lineIndex}`;
  const product = line.onlineposProductId ?? normalizeKey(line.onlineposProductName) ?? "product";
  return `historical-replay:${replayRunId}:${transaction}:${lineId}:${product}`;
}

export function productionExternalLineId(line: HistoricalReplayLineIdentity) {
  return [
    line.transactionId ?? line.receiptNumber ?? "transaction",
    line.lineId ?? `line-${line.lineIndex}`,
    line.onlineposProductId ?? normalizeKey(line.onlineposProductName) ?? "product",
  ].join(":");
}

export function validateReplayConfirmation(mode: ReplayMode, confirmation: string | null | undefined) {
  if (mode === "test-run" && !isReplayConfirmationMatch(confirmation)) {
    return "Test-run kræver bekræftelsen KØR HISTORISK TEST";
  }
  if (mode === "replay" && canonicalizeReplayConfirmation(confirmation) !== canonicalizeReplayConfirmation(historicalReplayProductionConfirmationText)) {
    return `Faktisk replay kræver bekræftelsen ${historicalReplayProductionConfirmationText}`;
  }
  return null;
}

export const historicalReplayConfirmationText = "KØR HISTORISK TEST";
export const historicalReplayProductionConfirmationText = "KØR FAKTISK REPLAY";

export function canonicalizeReplayConfirmation(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase("da-DK");
}

export function isReplayConfirmationMatch(value: string | null | undefined) {
  return canonicalizeReplayConfirmation(value) === canonicalizeReplayConfirmation(historicalReplayConfirmationText);
}

export function validateCleanupConfirmation(confirmation: string | null | undefined) {
  return confirmation === "SLET REPLAYDATA";
}

function parseCopenhagenLocal(date: string, time: string) {
  return new Date(`${date}T${time}:00+02:00`);
}

function formatLocalTime(date: Date) {
  return new Intl.DateTimeFormat("da-DK", { timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(".", ":");
}

function normalizeKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("da-DK").replace(/[^a-z0-9æøå]+/g, "-") || null;
}
