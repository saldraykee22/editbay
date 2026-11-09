/**
 * Short, human-readable identifiers.
 *
 * Ids look like `c_3f9a2b`: a short role prefix plus six hex characters. They
 * are deliberately short so a whole project stays cheap to send to a model.
 */

let sequence = 0;

/**
 * Creates a short id such as `c_3f9a2b`.
 *
 * The prefix is kept verbatim (trimmed); an empty prefix falls back to `id`.
 * Collisions are extremely unlikely but not impossible — callers that need
 * strict uniqueness should check the target collection.
 */
export function createId(prefix: string): string {
  sequence = (sequence + 1) % 0xffffff;
  const random = Math.floor(Math.random() * 0xffffff);
  const mixed = (random ^ (sequence * 0x9e3779)) & 0xffffff;
  const hex = mixed.toString(16).padStart(6, '0');
  const safePrefix = typeof prefix === 'string' ? prefix.trim() || 'id' : 'id';
  return `${safePrefix}_${hex}`;
}
