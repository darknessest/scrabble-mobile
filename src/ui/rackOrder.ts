export function reconcileOrder<T>(
  prevOrder: string[],
  items: T[],
  getId: (item: T) => string
): string[] {
  const present = new Set(items.map(getId));
  const next = prevOrder.filter((id) => present.has(id));
  const already = new Set(next);
  for (const item of items) {
    const id = getId(item);
    if (!already.has(id)) next.push(id);
  }
  return next;
}

export function shuffleCopy<T>(arr: T[], rng: () => number = Math.random): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}


