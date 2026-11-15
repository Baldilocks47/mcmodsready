// Saved mod lists live in this browser's localStorage and nowhere else.
import { migrateList, type ModList } from '../core/share';

const KEY = 'mmr.lists.v1';

export function loadLists(): ModList[] {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '[]') as ModList[]).map(migrateList);
  } catch {
    return [];
  }
}

export function saveLists(lists: ModList[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(lists));
  } catch {
    // storage unavailable (private mode etc.); lists last for this visit only
  }
}
