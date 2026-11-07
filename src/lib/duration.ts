/** Parses the per-image duration input. Returns null unless it is a finite number > 0. */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}
