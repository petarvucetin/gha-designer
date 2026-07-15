// Comment-preserving save: reconcile the model onto the original file's
// lossless Document so untouched subtrees keep their comments/formatting.
import { parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { buildDoc, toYaml } from './toYaml';
import type { GraphSnapshot } from './types';

/** Structural equality for JSON-shaped values (object key order ignored). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function definedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => obj[k] !== undefined);
}

function reconcile(doc: Document, path: unknown[], oldV: unknown, newV: unknown): void {
  if (deepEqual(oldV, newV)) return; // untouched subtree — comments survive
  if (isPlainObject(oldV) && isPlainObject(newV)) {
    const keep = new Set(definedKeys(newV));
    for (const k of Object.keys(oldV)) if (!keep.has(k)) doc.deleteIn([...path, k]);
    for (const k of keep) {
      if (k in oldV) reconcile(doc, [...path, k], oldV[k], newV[k]);
      else doc.setIn([...path, k], newV[k]);
    }
    return;
  }
  if (Array.isArray(oldV) && Array.isArray(newV)) {
    for (let i = oldV.length - 1; i >= newV.length; i--) doc.deleteIn([...path, i]);
    for (let i = 0; i < newV.length; i++) {
      if (i < oldV.length) reconcile(doc, [...path, i], oldV[i], newV[i]);
      else doc.setIn([...path, i], newV[i]);
    }
    return;
  }
  doc.setIn(path, newV); // scalar or shape change — replace in place
}

/**
 * Re-emit `snapshot` as YAML, preserving comments/key order of `originalText`
 * wherever the semantic content is unchanged. Falls back to canonical
 * `toYaml` when the original cannot be losslessly parsed as a mapping.
 */
export function updateYaml(originalText: string, snapshot: GraphSnapshot): string {
  const doc = parseDocument(originalText);
  if (doc.errors.length > 0) return toYaml(snapshot);
  const oldJS: unknown = doc.toJS();
  if (!isPlainObject(oldJS)) return toYaml(snapshot);
  reconcile(doc, [], oldJS, buildDoc(snapshot));
  return doc.toString({ indent: 2 });
}
