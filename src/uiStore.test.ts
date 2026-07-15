import { describe, expect, it } from 'vitest';
import { useUi } from './uiStore';

describe('uiStore', () => {
  it('setSidebarTab switches tabs', () => {
    useUi.getState().setSidebarTab('yaml');
    expect(useUi.getState().sidebarTab).toBe('yaml');
  });
  it('focusStep forces config tab + a stamped target; is one-shot via consumeStepFocus', () => {
    useUi.getState().setSidebarTab('problems');
    useUi.getState().focusStep('job:build', 's1');
    const f = useUi.getState();
    expect(f.sidebarTab).toBe('config');
    expect(f.stepFocus).toMatchObject({ nodeId: 'job:build', stepId: 's1' });
    const stamp1 = f.stepFocus!.stamp;
    useUi.getState().focusStep('job:build', 's1'); // re-focusing the SAME target gets a fresh stamp (replay)
    expect(useUi.getState().stepFocus!.stamp).toBeGreaterThan(stamp1);
    useUi.getState().consumeStepFocus();
    expect(useUi.getState().stepFocus).toBeNull();
  });
  it('activeView defaults to workflow; showRun/showWorkflow switch it', () => {
    expect(useUi.getState().activeView).toBe('workflow');
    useUi.getState().showRun();
    expect(useUi.getState().activeView).toBe('run');
    useUi.getState().showWorkflow();
    expect(useUi.getState().activeView).toBe('workflow');
  });
  it('setNotice sets a notice with a fresh token; clearNotice(token) only clears if it matches the current one', () => {
    useUi.getState().setNotice('Resolving…', 'info');
    const first = useUi.getState().notice;
    expect(first).toMatchObject({ msg: 'Resolving…', kind: 'info' });
    const staleToken = first!.token;

    // A newer notice supersedes the first before its timer fires.
    useUi.getState().setNotice('Added foo', 'info');
    const second = useUi.getState().notice;
    expect(second!.token).toBeGreaterThan(staleToken);

    // The stale timer's clearNotice(staleToken) must NOT clear the newer notice.
    useUi.getState().clearNotice(staleToken);
    expect(useUi.getState().notice).toEqual(second);

    // clearNotice with the current token clears it.
    useUi.getState().clearNotice(second!.token);
    expect(useUi.getState().notice).toBeNull();

    // clearNotice() with no token clears unconditionally.
    useUi.getState().setNotice('Couldn’t resolve', 'error');
    useUi.getState().clearNotice();
    expect(useUi.getState().notice).toBeNull();
  });
});
