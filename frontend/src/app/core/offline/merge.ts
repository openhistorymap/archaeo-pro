/**
 * Three-way merge of the JSON files a surveillance is made of.
 *
 * When a file changed on GitHub while a local edit was waiting, we know three
 * versions: the base (what both sides last agreed on), mine (this device) and
 * theirs (GitHub, i.e. a colleague). Each field is merged on its own:
 *
 * - changed on one side only: that side wins;
 * - changed on both sides to the same value: fine;
 * - objects: merged field by field, recursively;
 * - lists of records with an identity (`id`, `name`, `number` or `date`, e.g.
 *   the day's `presenze`): merged record by record, so two people adding
 *   themselves to the same day both stay;
 * - `created_at` / `updated_at`: the later one, never a clash;
 * - anything else changed on both sides is a clash: mine is kept, theirs is
 *   reported so a person can choose.
 */

export interface Clash {
  /** Dotted path of the field, e.g. "operazioni" or "presenze[Rossi].hours_end". */
  path: string;
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

export interface MergeResult {
  merged: unknown;
  clashes: Clash[];
}

const TIMESTAMPS = new Set(['created_at', 'updated_at']);
const IDENTITY_KEYS = ['id', 'name', 'number', 'date'] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/** The identity field shared by every record of a list, if any. */
function identityOf(lists: unknown[][]): (typeof IDENTITY_KEYS)[number] | null {
  const items = lists.flat();
  if (items.length === 0 || !items.every(isObject)) return null;
  for (const k of IDENTITY_KEYS) {
    if (
      !items.every((it) => ['string', 'number'].includes(typeof (it as Record<string, unknown>)[k]))
    )
      continue;
    const unique = lists.every(
      (l) => new Set(l.map((it) => (it as Record<string, unknown>)[k])).size === l.length,
    );
    if (unique) return k;
  }
  return null;
}

export function merge3(base: unknown, mine: unknown, theirs: unknown, path = ''): MergeResult {
  if (deepEqual(mine, theirs)) return { merged: mine, clashes: [] };
  if (deepEqual(mine, base)) return { merged: theirs, clashes: [] };
  if (deepEqual(theirs, base)) return { merged: mine, clashes: [] };

  if (isObject(mine) && isObject(theirs)) {
    const b = isObject(base) ? base : {};
    const merged: Record<string, unknown> = {};
    const clashes: Clash[] = [];
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(b)]);
    for (const k of keys) {
      if (TIMESTAMPS.has(k)) {
        const v = [mine[k], theirs[k]]
          .filter((x) => typeof x === 'string')
          .sort()
          .pop();
        if (v !== undefined) merged[k] = v;
        continue;
      }
      const r = merge3(b[k], mine[k], theirs[k], path ? `${path}.${k}` : k);
      if (r.merged !== undefined) merged[k] = r.merged;
      clashes.push(...r.clashes);
    }
    return { merged, clashes };
  }

  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const b = Array.isArray(base) ? base : [];
    const id = identityOf([b, mine, theirs]);
    if (id) {
      const index = (l: unknown[]) =>
        new Map(l.map((it) => [String((it as Record<string, unknown>)[id]), it]));
      const [bm, mm, tm] = [index(b), index(mine), index(theirs)];
      const order = [...tm.keys(), ...[...mm.keys()].filter((k) => !tm.has(k))];
      const merged: unknown[] = [];
      const clashes: Clash[] = [];
      for (const k of order) {
        const r = merge3(bm.get(k), mm.get(k), tm.get(k), `${path}[${k}]`);
        if (r.merged !== undefined) merged.push(r.merged);
        clashes.push(...r.clashes);
      }
      return { merged, clashes };
    }
  }

  return { merged: mine, clashes: [{ path: path || '(intero file)', base, mine, theirs }] };
}

/**
 * Merge three versions of a JSON file. `base` null means the file is new on
 * both sides (two people created the same day's log). Returns null when a
 * version is not JSON, so the caller can fall back to keeping a copy.
 */
export function mergeJsonText(
  base: string | null,
  mine: string,
  theirs: string,
): { text: string; clashes: Clash[] } | null {
  let b: unknown, m: unknown, t: unknown;
  try {
    b = base === null ? {} : JSON.parse(base);
    m = JSON.parse(mine);
    t = JSON.parse(theirs);
  } catch {
    return null;
  }
  const { merged, clashes } = merge3(b, m, t);
  return { text: JSON.stringify(merged, null, 2) + '\n', clashes };
}

/** Set a value at a dotted/[key] path produced by merge3, for applying "theirs" to one field. */
export function setAtPath(root: unknown, path: string, value: unknown): unknown {
  if (path === '(intero file)' || path === '') return value;
  const parts = path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [];
  const copy = structuredClone(root) as Record<string, unknown>;
  let node: unknown = copy;
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const part = parts[i];
    if (part.startsWith('[')) {
      const key = part.slice(1, -1);
      const list = node as Record<string, unknown>[];
      const at = list.findIndex((it) => IDENTITY_KEYS.some((k) => String(it?.[k]) === key));
      if (last) {
        if (value === undefined) list.splice(at, 1);
        else if (at < 0) list.push(value as Record<string, unknown>);
        else list[at] = value as Record<string, unknown>;
      } else {
        node = list[at];
      }
    } else {
      const obj = node as Record<string, unknown>;
      if (last) {
        if (value === undefined) delete obj[part];
        else obj[part] = value;
      } else {
        node = obj[part];
      }
    }
  }
  return copy;
}
