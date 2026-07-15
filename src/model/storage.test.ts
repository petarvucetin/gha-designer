import { describe, expect, it } from 'vitest';
import { defaultFileName, parseStorage } from './storage';

const doc = (id: string, fileName: string) => ({
  id, fileName, meta: { name: id }, nodes: [], edges: [],
});

describe('defaultFileName', () => {
  it('slugs and dedupes against taken stems', () => {
    expect(defaultFileName('My CI Flow', [])).toBe('my-ci-flow.yml');
    expect(defaultFileName('build', ['build.yml'])).toBe('build-2.yml');
    expect(defaultFileName('build', ['build.yaml', 'build-2.yml'])).toBe('build-3.yml');
    expect(defaultFileName('', [])).toBe('workflow.yml');
  });
});

describe('parseStorage', () => {
  it('accepts a valid v2 payload', () => {
    const s = parseStorage(JSON.stringify({ version: 2, activeId: 'a', workflows: [doc('a', 'a.yml')] }), null);
    expect(s?.activeId).toBe('a');
    expect(s?.workflows).toHaveLength(1);
  });

  it('salvages per doc: one corrupt among three -> two survive', () => {
    const s = parseStorage(JSON.stringify({
      version: 2, activeId: 'b',
      workflows: [doc('a', 'a.yml'), { id: 'b', fileName: 7, meta: {}, nodes: 'x' }, doc('c', 'c.yml')],
    }), null);
    expect(s?.workflows.map((w) => w.id)).toEqual(['a', 'c']);
    expect(s?.activeId).toBe('a'); // activeId fallback to first survivor
  });

  it('salvages per doc: element-level corrupt node (nodes:[null]) is dropped', () => {
    const s = parseStorage(JSON.stringify({
      version: 2, activeId: 'a',
      workflows: [
        doc('a', 'a.yml'),
        { id: 'b', fileName: 'b.yml', meta: { name: 'b' }, nodes: [null], edges: [] },
      ],
    }), null);
    expect(s?.workflows.map((w) => w.id)).toEqual(['a']);
  });

  it('rejects a legacy v1 payload with an element-level corrupt node (nodes:[null])', () => {
    const v1 = JSON.stringify({ meta: { name: 'Legacy' }, nodes: [null], edges: [] });
    expect(parseStorage(null, v1)).toBeNull();
  });

  it('returns null when nothing survives or json is junk', () => {
    expect(parseStorage(JSON.stringify({ version: 2, activeId: 'x', workflows: [{}] }), null)).toBeNull();
    expect(parseStorage('{ nope', null)).toBeNull();
    expect(parseStorage(JSON.stringify({ version: 3, workflows: [] }), null)).toBeNull();
    expect(parseStorage(null, null)).toBeNull();
  });

  it('migrates a v1 single-snapshot payload into one doc, deriving fileName', () => {
    const v1 = JSON.stringify({
      meta: { name: 'Legacy Flow' },
      nodes: [{ id: 'trigger:push', type: 'trigger', position: { x: 1, y: 2 }, data: { kind: 'trigger', trigger: 'push' } }],
      edges: [],
    });
    const s = parseStorage(null, v1);
    expect(s?.workflows).toHaveLength(1);
    expect(s?.workflows[0].fileName).toBe('legacy-flow.yml');
    expect(s?.workflows[0].meta.name).toBe('Legacy Flow');
    expect(s?.activeId).toBe(s?.workflows[0].id);
  });

  it('v2 wins over v1 when both exist; corrupt v1 -> null', () => {
    const v2 = JSON.stringify({ version: 2, activeId: 'a', workflows: [doc('a', 'a.yml')] });
    expect(parseStorage(v2, 'garbage')?.activeId).toBe('a');
    expect(parseStorage(null, JSON.stringify({ foo: 1 }))).toBeNull();
  });
});
