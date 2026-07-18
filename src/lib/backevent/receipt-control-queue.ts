export type ReceiptControlQueueState = {
  previousHref: string | null;
  nextHref: string | null;
  position: number;
  total: number;
};

export function buildReceiptControlQueueState(input: {
  currentId: string;
  items: string[];
  page: number;
  pageSize: number;
  total: number;
  baseQuery: string;
  previousPageLastId?: string | null;
  nextPageFirstId?: string | null;
}): ReceiptControlQueueState {
  const index = input.items.indexOf(input.currentId);
  if (index < 0) return { previousHref: null, nextHref: null, position: 0, total: input.total };
  const previousId = index > 0 ? input.items[index - 1] : input.previousPageLastId ?? null;
  const nextId = index < input.items.length - 1 ? input.items[index + 1] : input.nextPageFirstId ?? null;
  return {
    previousHref: previousId ? queueHref(previousId, input.baseQuery, index > 0 ? input.page : input.page - 1, index > 0 ? index - 1 : input.pageSize - 1) : null,
    nextHref: nextId ? queueHref(nextId, input.baseQuery, index < input.items.length - 1 ? input.page : input.page + 1, index < input.items.length - 1 ? index + 1 : 0) : null,
    position: (input.page - 1) * input.pageSize + index + 1,
    total: input.total,
  };
}

function queueHref(id: string, baseQuery: string, page: number, index: number) {
  const params = new URLSearchParams(baseQuery);
  params.set("page", String(page));
  params.set("queueIndex", String(index));
  return `/retur/kontrol/${id}?${params}`;
}
