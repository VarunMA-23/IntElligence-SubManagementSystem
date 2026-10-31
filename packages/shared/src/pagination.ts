export interface PaginationMeta {
  page: number;
  per_page: number;
  total_items: number;
  total_pages: number;
}

export function paginationMeta(page: number, perPage: number, totalItems: number): PaginationMeta {
  return {
    page,
    per_page: perPage,
    total_items: totalItems,
    total_pages: totalItems === 0 ? 0 : Math.ceil(totalItems / perPage),
  };
}

export function orderByToSort(orderBy: string | undefined, fallback: Record<string, 1 | -1> = { createdAt: -1 }) {
  if (!orderBy) return fallback;
  const [column, direction] = orderBy.split(".");
  if (!column) return fallback;
  return { [column]: direction === "asc" ? (1 as const) : (-1 as const) };
}
