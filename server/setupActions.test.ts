import { describe, expect, it } from 'vitest';
import { resolveSetupAction, SETUP_ACTION_FALLBACK } from './setupActions';

describe('resolveSetupAction', () => {
  it('resolves podman-machine-start to a fixed command', () => {
    expect(resolveSetupAction('podman-machine-start')).toEqual({ cmd: 'podman', args: ['machine', 'start'] });
  });
  it('resolves pull-image for docker to a fixed pull of the runner image', () => {
    expect(resolveSetupAction('pull-image', 'docker')).toEqual({ cmd: 'docker', args: ['pull', 'catthehacker/ubuntu:act-latest'] });
  });
  it('resolves pull-image for podman to a fixed pull of the runner image', () => {
    expect(resolveSetupAction('pull-image', 'podman')).toEqual({ cmd: 'podman', args: ['pull', 'catthehacker/ubuntu:act-latest'] });
  });
  it('rejects pull-image with an engine outside the enum', () => {
    expect(resolveSetupAction('pull-image', 'evil; rm -rf')).toBeNull();
  });
  it('rejects pull-image with no engine', () => {
    expect(resolveSetupAction('pull-image')).toBeNull();
  });
  it('rejects unknown action ids', () => {
    expect(resolveSetupAction('rm -rf /')).toBeNull();
    expect(resolveSetupAction('')).toBeNull();
  });
});

describe('SETUP_ACTION_FALLBACK', () => {
  it('falls back podman-machine-start to init then start', () => {
    expect(SETUP_ACTION_FALLBACK['podman-machine-start']).toEqual([
      { cmd: 'podman', args: ['machine', 'init'] },
      { cmd: 'podman', args: ['machine', 'start'] },
    ]);
  });
  it('has no fallback for pull-image', () => {
    expect(SETUP_ACTION_FALLBACK['pull-image']).toBeUndefined();
  });
});
