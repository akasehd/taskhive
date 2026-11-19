/**
 * Fractional positions let a card move between two neighbours with a single
 * row update: its new position is the midpoint of theirs. When gaps get too
 * small for floating point, the list is renumbered.
 */
export const STEP = 1024;
const MIN_GAP = 1e-6;

/** Position for an item placed between `before` and `after` (either may be null). */
export function between(before, after) {
  if (before == null && after == null) return STEP;
  if (before == null) return after - STEP;
  if (after == null) return before + STEP;
  return (before + after) / 2;
}

export function needsRebalance(before, after) {
  return before != null && after != null && after - before < MIN_GAP;
}

/** Evenly re-spaces positions in a table for the given parent, keeping order. */
export function rebalance(db, table, parentColumn, parentId) {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE ${parentColumn} = ? ORDER BY position, id`).all(parentId);
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?`);
  rows.forEach((r, i) => update.run((i + 1) * STEP, r.id));
}
