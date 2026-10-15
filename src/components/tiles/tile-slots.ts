import type { TileInstance } from './tile-contract';

/** Persistent string identity, with power-of-two spare capacity. Packed draw
 * indices are private; animation and picking always resolve through these slots. */
export class TileSlots {
  private ids = new Map<string, number>();
  private capacity = 0;
  reconcile(tiles: readonly TileInstance[]) {
    const live = new Set(tiles.map(tile => tile.id));
    if (live.size !== tiles.length) throw new Error('Tile ids must be unique');
    for (const id of this.ids.keys()) if (!live.has(id)) this.ids.delete(id);
    const used = new Set(this.ids.values());
    let free = 0;
    for (const tile of tiles) {
      if (this.ids.has(tile.id)) continue;
      while (used.has(free)) free += 1;
      this.ids.set(tile.id, free);
      used.add(free);
    }
    const needed = Math.max(1, ...used) + 1;
    while (this.capacity < needed)
      this.capacity = Math.max(16, this.capacity * 2);
    const slots: (TileInstance | null)[] = Array(this.capacity).fill(null);
    for (const tile of tiles) slots[this.ids.get(tile.id)!] = tile;
    return { slots, capacity: this.capacity };
  }
}
