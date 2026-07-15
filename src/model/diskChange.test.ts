import { describe, expect, it } from 'vitest';
import { diskChangeDoc, mergePositions } from './diskChange';
import { fromYaml } from './fromYaml';
import { toYaml } from './toYaml';
import { hashText } from './hash';
import type { WorkflowDoc } from './types';

const CI = 'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls\n';

function boundDoc(text: string, over: Partial<NonNullable<WorkflowDoc['sourceRt']>> = {}): WorkflowDoc {
  const snap = fromYaml(text);
  return {
    id: 'w1', fileName: 'ci.yml', meta: snap.meta, nodes: snap.nodes, edges: snap.edges,
    source: { root: 'R', path: 'workflows/ci.yml', diskHash: hashText(text) },
    sourceRt: { baseline: toYaml(snap), conflict: false, detached: false, mtimeMs: 100, diskText: text, ...over },
  };
}

// A doc as it comes back from localStorage after a reboot: source present, sourceRt stripped.
function rebootedDoc(text: string, over: Partial<NonNullable<WorkflowDoc['source']>> = {}): WorkflowDoc {
  const snap = fromYaml(text);
  return {
    id: 'w1', fileName: 'ci.yml', meta: snap.meta, nodes: snap.nodes, edges: snap.edges,
    source: { root: 'R', path: 'workflows/ci.yml', diskHash: hashText(text), ...over },
  };
}

describe('diskChangeDoc reboot reconcile (source present, sourceRt stripped)', () => {
  it('re-initializes sourceRt from disk so the tab is linked again (clean, unchanged disk)', () => {
    const r = diskChangeDoc(rebootedDoc(CI), CI, 200);
    expect(r.kind).toBe('flags');
    if (r.kind !== 'flags') return;
    expect(r.doc.sourceRt).toBeDefined();
    expect(r.doc.sourceRt!.detached).toBe(false);
    expect(r.doc.sourceRt!.conflict).toBe(false);
    expect(r.doc.sourceRt!.baseline).toBe(toYaml(fromYaml(CI)));
    expect(r.doc.sourceRt!.mtimeMs).toBe(200);
    expect(r.doc.sourceRt!.diskText).toBe(CI);
  });

  it('flags a conflict when the disk changed offline and the canvas diverges', () => {
    // persisted diskHash is for the OLD disk; the canvas (nodes from persisted state) matches OLD,
    // but the file on disk is now different → offline external edit → conflict.
    const doc = rebootedDoc(CI); // canvas == CI, source.diskHash == hash(CI)
    const changedDisk = CI.replace('ls', 'pwd');
    const r = diskChangeDoc(doc, changedDisk, 200);
    expect(r.kind).toBe('flags');
    if (r.kind !== 'flags') return;
    expect(r.doc.sourceRt!.conflict).toBe(true);
    expect(r.doc.source!.diskHash).toBe(hashText(changedDisk));
    expect(r.doc.sourceRt!.diskText).toBe(changedDisk);
  });

  it('marks detached when the bound file is gone on reboot', () => {
    const r = diskChangeDoc(rebootedDoc(CI), null, 200);
    expect(r.kind).toBe('flags');
    if (r.kind !== 'flags') return;
    expect(r.doc.sourceRt!.detached).toBe(true);
    // no disk text exists: diskText falls back to the canvas-canonical YAML, same as baseline
    expect(r.doc.sourceRt!.diskText).toBe(toYaml(fromYaml(CI)));
    expect(r.doc.sourceRt!.diskText).toBe(r.doc.sourceRt!.baseline);
  });

  it('an unbound doc (no source) is still a no-op', () => {
    const snap = fromYaml(CI);
    const unbound: WorkflowDoc = { id: 'w2', fileName: 'x.yml', meta: snap.meta, nodes: snap.nodes, edges: snap.edges };
    expect(diskChangeDoc(unbound, CI, 200)).toEqual({ kind: 'none' });
  });
});

describe('mergePositions', () => {
  it('keeps matched positions, lays out new ids, detects identity changes', () => {
    const cur = [{ id: 'a', type: 'job' as const, position: { x: 5, y: 6 }, data: { kind: 'job' as const, jobId: 'a', runsOn: 'x', steps: [] } }];
    const laid = [
      { id: 'a', type: 'job' as const, position: { x: 0, y: 0 }, data: { kind: 'job' as const, jobId: 'a', runsOn: 'x', steps: [] } },
      { id: 'b', type: 'job' as const, position: { x: 100, y: 0 }, data: { kind: 'job' as const, jobId: 'b', runsOn: 'x', steps: [] } },
    ];
    const { nodes, identityChanged } = mergePositions(cur, laid);
    expect(nodes.find((n) => n.id === 'a')!.position).toEqual({ x: 5, y: 6 });
    expect(nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 100, y: 0 });
    expect(identityChanged).toBe(true);
  });
});

describe('diskChangeDoc', () => {
  it('ROW monotonic: ignores an older-mtime change', () => {
    expect(diskChangeDoc(boundDoc(CI, { mtimeMs: 500 }), CI.replace('ls', 'pwd'), 400)).toEqual({ kind: 'none' });
  });
  it('ROW null: marks detached, keeps the canvas', () => {
    const r = diskChangeDoc(boundDoc(CI), null, 200);
    expect(r).toMatchObject({ kind: 'flags' });
    if (r.kind === 'flags') {
      expect(r.doc.sourceRt!.detached).toBe(true);
      // spread path (...rt): the last-known disk text is carried forward unchanged
      expect(r.doc.sourceRt!.diskText).toBe(CI);
    }
  });
  it('ROW echo: identical-recreate clears detached+conflict and bumps mtime', () => {
    // baseline overridden to literally equal the incoming text: a genuine no-divergence echo.
    const r = diskChangeDoc(boundDoc(CI, { detached: true, conflict: true, baseline: CI }), CI, 300);
    expect(r).toMatchObject({ kind: 'flags' });
    if (r.kind === 'flags') {
      expect(r.doc.sourceRt!.detached).toBe(false);
      expect(r.doc.sourceRt!.conflict).toBe(false);
      expect(r.doc.sourceRt!.mtimeMs).toBe(300);
      expect(r.doc.sourceRt!.diskText).toBe(CI);
    }
  });
  it('ROW echo: duplicate event for still-conflicting content keeps conflict flagged', () => {
    const doc = boundDoc(CI);
    const dirty = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'job:build' && n.data.kind === 'job'
      ? { ...n, data: { ...n.data, name: 'Renamed' } } : n)) };
    const changed = CI.replace('ls', 'pwd');
    const first = diskChangeDoc(dirty, changed, 200);
    if (first.kind !== 'flags') throw new Error('expected flags');
    expect(first.doc.sourceRt!.conflict).toBe(true);
    expect(first.doc.source!.diskHash).toBe(hashText(changed));
    expect(first.doc.sourceRt!.diskText).toBe(changed);
    // duplicate fs event: same fileText, same diskHash, later mtime — content still diverges from baseline.
    const second = diskChangeDoc(first.doc, changed, 300);
    expect(second).toMatchObject({ kind: 'flags' });
    if (second.kind === 'flags') {
      expect(second.doc.sourceRt!.conflict).toBe(true);
      expect(second.doc.sourceRt!.detached).toBe(false);
      expect(second.doc.sourceRt!.mtimeMs).toBe(300);
      expect(second.doc.sourceRt!.diskText).toBe(changed);
    }
  });
  it('ROW echo: disk reverted to baseline clears conflict', () => {
    const doc = boundDoc(CI, { conflict: true });
    const baseline = doc.sourceRt!.baseline;
    const reverted = { ...doc, source: { ...doc.source!, diskHash: hashText(baseline) } };
    const r = diskChangeDoc(reverted, baseline, 300);
    expect(r).toMatchObject({ kind: 'flags' });
    if (r.kind === 'flags') {
      expect(r.doc.sourceRt!.conflict).toBe(false);
      expect(r.doc.sourceRt!.detached).toBe(false);
      expect(r.doc.sourceRt!.mtimeMs).toBe(300);
      expect(r.doc.sourceRt!.diskText).toBe(baseline);
    }
  });
  it('ROW clean data-only: reloads, keeps surviving positions, identityChanged=false', () => {
    const doc = boundDoc(CI);
    const moved = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'job:build' ? { ...n, position: { x: 999, y: 888 } } : n)) };
    const changed = CI.replace('run: ls', 'run: echo hi');
    const r = diskChangeDoc(moved, changed, 200);
    expect(r.kind).toBe('reload');
    if (r.kind === 'reload') {
      expect(r.identityChanged).toBe(false);
      expect(r.doc.nodes.find((n) => n.id === 'job:build')!.position).toEqual({ x: 999, y: 888 });
      expect(r.doc.sourceRt!.mtimeMs).toBe(200);
      expect(r.doc.sourceRt!.diskText).toBe(changed);
    }
  });
  it('ROW clean identity-change: lays out genuinely new nodes, identityChanged=true', () => {
    const withTest = CI + '  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: t\n';
    const r = diskChangeDoc(boundDoc(CI), withTest, 200);
    expect(r.kind).toBe('reload');
    if (r.kind === 'reload') {
      expect(r.identityChanged).toBe(true);
      expect(r.doc.nodes.some((n) => n.id === 'job:test')).toBe(true);
      expect(r.doc.sourceRt!.diskText).toBe(withTest);
    }
  });
  it('ROW dirty: conflict, keeps edits, records new diskHash', () => {
    const doc = boundDoc(CI);
    const dirty = { ...doc, nodes: doc.nodes.map((n) => (n.id === 'job:build' && n.data.kind === 'job'
      ? { ...n, data: { ...n.data, name: 'Renamed' } } : n)) };
    const changed = CI.replace('ls', 'pwd');
    const r = diskChangeDoc(dirty, changed, 200);
    expect(r).toMatchObject({ kind: 'flags' });
    if (r.kind === 'flags') {
      expect(r.doc.sourceRt!.conflict).toBe(true);
      expect(r.doc.source!.diskHash).toBe(hashText(changed));
      expect(r.doc.sourceRt!.diskText).toBe(changed);
    }
  });
  it('ROW reparse-fail: clean tab but unparseable disk text → conflict, canvas kept', () => {
    const badText = 'name: [oops\n';
    const r = diskChangeDoc(boundDoc(CI), badText, 200);
    expect(r).toMatchObject({ kind: 'flags' });
    if (r.kind === 'flags') {
      expect(r.doc.sourceRt!.conflict).toBe(true);
      expect(r.doc.sourceRt!.diskText).toBe(badText);
    }
  });
});
