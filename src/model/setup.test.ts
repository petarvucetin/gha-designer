import { describe, expect, it } from 'vitest';
import { computeSetup, SAMPLE_WORKFLOW, SETUP_PATHS, type EnginesLike, type EngineStatus } from './setup';

function status(available: boolean): EngineStatus {
  return { available };
}

function engines(overrides: Partial<Record<keyof EnginesLike, boolean>>): EnginesLike {
  return {
    act: status(overrides.act ?? false),
    docker: status(overrides.docker ?? false),
    podman: status(overrides.podman ?? false),
    vm: status(overrides.vm ?? false),
  } as EnginesLike;
}

describe('SETUP_PATHS', () => {
  it('has ids docker, podman, vm in that order', () => {
    expect(SETUP_PATHS.map((p) => p.id)).toEqual(['docker', 'podman', 'vm']);
  });

  it('each path has at least one guidance step', () => {
    for (const p of SETUP_PATHS) {
      expect(p.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('SAMPLE_WORKFLOW', () => {
  it('is a non-empty string containing workflow_dispatch', () => {
    expect(typeof SAMPLE_WORKFLOW).toBe('string');
    expect(SAMPLE_WORKFLOW.length).toBeGreaterThan(0);
    expect(SAMPLE_WORKFLOW).toContain('workflow_dispatch');
  });
});

describe('computeSetup', () => {
  it('with undefined engines: nothing ready, recommends docker, act not ready', () => {
    const result = computeSetup(undefined);
    expect(result.anyReady).toBe(false);
    expect(result.paths.every((p) => p.ready === false)).toBe(true);
    expect(result.recommended).toBe('docker');
    expect(result.actReady).toBe(false);
  });

  it('docker available only: docker ready, anyReady, recommended docker', () => {
    const result = computeSetup(engines({ docker: true }));
    const docker = result.paths.find((p) => p.id === 'docker');
    expect(docker?.ready).toBe(true);
    expect(result.anyReady).toBe(true);
    expect(result.recommended).toBe('docker');
  });

  it('podman available only: recommended podman', () => {
    const result = computeSetup(engines({ podman: true }));
    expect(result.anyReady).toBe(true);
    expect(result.recommended).toBe('podman');
  });

  it('vm available (+ docker available): recommended vm (highest fidelity wins)', () => {
    const result = computeSetup(engines({ docker: true, vm: true }));
    expect(result.anyReady).toBe(true);
    expect(result.recommended).toBe('vm');
  });

  it('none available: anyReady false, recommended docker (easiest to set up)', () => {
    const result = computeSetup(engines({}));
    expect(result.anyReady).toBe(false);
    expect(result.recommended).toBe('docker');
  });

  it('actReady reflects engines.act.available', () => {
    expect(computeSetup(engines({ act: true })).actReady).toBe(true);
    expect(computeSetup(engines({ act: false })).actReady).toBe(false);
  });
});
