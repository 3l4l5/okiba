export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
}
