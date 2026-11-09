/**
 * Brand ids become directory names (`brands/<id>/identity.md`), so they must
 * never contain a path separator or a traversal segment. The pattern itself is
 * owned by `@editbay/harness` (the file store that writes those folders); this
 * module gives the CLI and MCP server one shared guard with a clear error.
 */
import { isSafeBrandId } from '@editbay/harness';

export { isSafeBrandId };

/** Throws a clear, model-readable error for an unsafe brand id. */
export function assertSafeBrandId(id: string): void {
  if (!isSafeBrandId(id)) {
    throw new Error(
      `Invalid brand id: "${id}". Use a short lowercase slug with letters, digits, dash or underscore ` +
        '(no slashes and no "..").',
    );
  }
}
