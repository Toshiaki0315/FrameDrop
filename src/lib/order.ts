const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Sorts paths by file name ascending (natural number order), ignoring directories. */
export function sortByFileName(paths: string[]): string[] {
  return [...paths].sort((a, b) => collator.compare(baseName(a), baseName(b)));
}

/** Returns a copy with the item at `from` moved to index `to`; unchanged for invalid indexes. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const valid = (i: number) => Number.isInteger(i) && i >= 0 && i < list.length;
  if (!valid(from) || !valid(to) || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
