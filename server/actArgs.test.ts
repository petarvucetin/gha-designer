import { describe, expect, it } from 'vitest';
import { buildActArgs, buildChildEnv, ubuntuLabelsOf, validateFileNames } from './actArgs';
import type { RunRequest } from './types';

const base: RunRequest = {
  workflows: [{ fileName: 'ci.yml', yaml: 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls' }],
  target: 'ci.yml', event: 'push', engine: 'docker',
  image: 'node:20-bookworm-slim', pull: false,
};

describe('buildActArgs', () => {
  it('builds the core argv with explicit -P for every ubuntu label', () => {
    const args = buildActArgs({
      ...base,
      workflows: [
        { fileName: 'ci.yml', yaml: 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps: []\n  b:\n    runs-on: ubuntu-22.04\n    steps: []' },
      ],
    });
    expect(args[0]).toBe('push');
    expect(args).toContain('--json');
    expect(args.join(' ')).toContain('-W .github/workflows/ci.yml');
    expect(args.join(' ')).toContain('-P ubuntu-latest=node:20-bookworm-slim');
    expect(args.join(' ')).toContain('-P ubuntu-22.04=node:20-bookworm-slim');
    expect(args).toContain('--pull=false');
  });

  it('adds job, inputs, vars and NAME-ONLY secrets', () => {
    const args = buildActArgs({
      ...base, job: 'a',
      inputs: { env: 'prod' }, vars: { V: '1' }, secrets: { TOKEN: 'supersecret' },
    });
    expect(args.join(' ')).toContain('-j a');
    expect(args.join(' ')).toContain('--input env=prod');
    expect(args.join(' ')).toContain('--var V=1');
    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('TOKEN');
    expect(args.join(' ')).not.toContain('supersecret');
  });

  it('podman adds --container-daemon-socket - and docker does not', () => {
    expect(buildActArgs({ ...base, engine: 'podman' })).toContain('--container-daemon-socket');
    expect(buildActArgs(base).join(' ')).not.toContain('--container-daemon-socket');
  });

  it('enables the artifact server via a per-run relative _artifacts dir', () => {
    const args = buildActArgs(base);
    expect(args.join(' ')).toContain('--artifact-server-path _artifacts');
  });
});

describe('buildChildEnv', () => {
  const dirty = { PATH: 'p', DOCKER_HOST: 'npipe:////./pipe/podman-machine-default', DOCKER_CONTEXT: 'x', CONTAINER_HOST: 'y' };
  it('docker strips engine vars so act uses its default resolution', () => {
    const env = buildChildEnv(base, dirty);
    expect(env.DOCKER_HOST).toBeUndefined();
    expect(env.DOCKER_CONTEXT).toBeUndefined();
    expect(env.CONTAINER_HOST).toBeUndefined();
    expect(env.PATH).toBe('p');
  });
  it('podman sets DOCKER_HOST to the resolved socket', () => {
    const env = buildChildEnv({ ...base, engine: 'podman' }, dirty, 'npipe:////./pipe/podman-machine-default');
    expect(env.DOCKER_HOST).toBe('npipe:////./pipe/podman-machine-default');
  });
  it('secret values land in env, not argv', () => {
    const env = buildChildEnv({ ...base, secrets: { TOKEN: 'supersecret' } }, dirty);
    expect(env.TOKEN).toBe('supersecret');
  });
  it('a secret named after a stripped engine var does not reintroduce it', () => {
    const env = buildChildEnv(
      { ...base, secrets: { DOCKER_HOST: 'evil', DOCKER_CONTEXT: 'evil', CONTAINER_HOST: 'evil' } },
      dirty,
    );
    expect(env.DOCKER_HOST).toBeUndefined();
    expect(env.DOCKER_CONTEXT).toBeUndefined();
    expect(env.CONTAINER_HOST).toBeUndefined();
  });
});

describe('ubuntuLabelsOf / validateFileNames', () => {
  it('collects distinct ubuntu labels across workflows, skipping bad yaml', () => {
    expect(ubuntuLabelsOf([
      { yaml: 'jobs:\n  a:\n    runs-on: ubuntu-latest\n  b:\n    runs-on: [self-hosted, ubuntu-24.04]' },
      { yaml: '{ not yaml' },
    ]).sort()).toEqual(['ubuntu-24.04', 'ubuntu-latest']);
  });
  it('collects ubuntu labels from the object {group, labels} runs-on form', () => {
    expect(ubuntuLabelsOf([
      { yaml: 'jobs:\n  a:\n    runs-on:\n      group: g\n      labels: [ubuntu-22.04]' },
    ])).toEqual(['ubuntu-22.04']);
  });
  it('rejects device names, trailing dots and case-colliding duplicates', () => {
    expect(validateFileNames([{ fileName: 'con.yml', yaml: '' }])).toMatch(/reserved/i);
    expect(validateFileNames([{ fileName: 'a .yml', yaml: '' }])).toMatch(/invalid/i);
    expect(validateFileNames([{ fileName: 'A.yml', yaml: '' }, { fileName: 'a.yml', yaml: '' }])).toMatch(/duplicate/i);
    expect(validateFileNames([{ fileName: 'ok.yml', yaml: '' }])).toBeNull();
  });
});

describe('RunRequest vm/mode types', () => {
  it('buildActArgs ignores mode (mode is VM-only, act args unchanged)', () => {
    const base: RunRequest = { workflows: [{ fileName: 'ci.yml', yaml: 'on: push\njobs: {}' }], target: 'ci.yml', event: 'push', engine: 'docker', image: 'img', pull: false };
    const withMode = { ...base, mode: 'self-hosted' as const };
    expect(buildActArgs(withMode)).toEqual(buildActArgs(base));
  });
});
