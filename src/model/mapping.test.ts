import { describe, expect, it } from 'vitest';
import {
  concurrencyToYaml, defaultsToYaml, parseConcurrency, parseDefaults,
  parsePermissions, permissionsToYaml, environmentToYaml, isRunsOnEmpty, parseEnvironment, parseRunsOn, runsOnLabel, runsOnToYaml,
  containerToYaml, parseContainer, parseStrategy, strategyToYaml, coerceScalar, uniqueName,
} from './mapping';

describe('mapping', () => {
  it('permissions: string forms and valid maps parse; junk does not', () => {
    expect(parsePermissions('read-all')).toBe('read-all');
    expect(parsePermissions('write-all')).toBe('write-all');
    expect(parsePermissions({ contents: 'read', 'id-token': 'write' }))
      .toEqual({ contents: 'read', 'id-token': 'write' });
    expect(parsePermissions({})).toEqual({});
    expect(parsePermissions({ contents: 'admin' })).toBeUndefined();
    expect(parsePermissions(42)).toBeUndefined();
    expect(permissionsToYaml('read-all')).toBe('read-all');
    expect(permissionsToYaml({ contents: 'read' })).toEqual({ contents: 'read' });
  });

  it('concurrency: string shorthand and map parse; exports as map', () => {
    expect(parseConcurrency('ci-${{ github.ref }}')).toEqual({ group: 'ci-${{ github.ref }}' });
    expect(parseConcurrency({ group: 'g', 'cancel-in-progress': true }))
      .toEqual({ group: 'g', cancelInProgress: true });
    expect(parseConcurrency({ 'cancel-in-progress': true })).toBeUndefined();
    expect(concurrencyToYaml({ group: 'g' })).toEqual({ group: 'g' });
    expect(concurrencyToYaml({ group: 'g', cancelInProgress: '${{ x }}' }))
      .toEqual({ group: 'g', 'cancel-in-progress': '${{ x }}' });
  });

  it('defaults: run shell/working-directory parse; foreign keys reject', () => {
    expect(parseDefaults({ run: { shell: 'bash', 'working-directory': 'app' } }))
      .toEqual({ shell: 'bash', workingDirectory: 'app' });
    expect(parseDefaults({ run: { shell: 'bash', weird: 1 } })).toBeUndefined();
    expect(parseDefaults({ other: {} })).toBeUndefined();
    expect(defaultsToYaml({ shell: 'pwsh' })).toEqual({ run: { shell: 'pwsh' } });
  });
});

describe('runs-on and environment mapping', () => {
  it('parses the three runs-on forms; rejects junk', () => {
    expect(parseRunsOn('ubuntu-latest')).toBe('ubuntu-latest');
    expect(parseRunsOn(['self-hosted', 'linux'])).toEqual(['self-hosted', 'linux']);
    expect(parseRunsOn({ group: 'big', labels: ['gpu'] })).toEqual({ group: 'big', labels: ['gpu'] });
    expect(parseRunsOn({ group: 'big' })).toEqual({ group: 'big' });
    expect(parseRunsOn({ labels: ['x'] })).toBeUndefined();
    expect(parseRunsOn(7)).toBeUndefined();
  });

  it('labels and emptiness', () => {
    expect(runsOnLabel(['self-hosted', 'linux'])).toBe('self-hosted, linux');
    expect(runsOnLabel({ group: 'big' })).toBe('group:big');
    expect(isRunsOnEmpty('')).toBe(true);
    expect(isRunsOnEmpty([])).toBe(true);
    expect(isRunsOnEmpty({ group: ' ' })).toBe(true);
    expect(isRunsOnEmpty('ubuntu-latest')).toBe(false);
  });

  it('environment string and object forms', () => {
    expect(parseEnvironment('prod')).toBe('prod');
    expect(parseEnvironment({ name: 'prod', url: 'https://x' })).toEqual({ name: 'prod', url: 'https://x' });
    expect(parseEnvironment({ url: 'https://x' })).toBeUndefined();
    expect(environmentToYaml('prod')).toBe('prod');
    expect(environmentToYaml({ name: 'p', url: 'u' })).toEqual({ name: 'p', url: 'u' });
  });
});

describe('container and strategy mapping', () => {
  it('container string shorthand and full form; round-trip shape preserved', () => {
    expect(parseContainer('node:18')).toEqual({ image: 'node:18' });
    expect(containerToYaml({ image: 'node:18' })).toBe('node:18');
    const full = {
      image: 'postgres:16',
      credentials: { username: 'u', password: '${{ secrets.P }}' },
      env: { POSTGRES_DB: 'app' }, ports: ['5432:5432'], volumes: ['/d:/var/lib'], options: '--cpus 1',
    };
    expect(parseContainer({
      image: 'postgres:16', credentials: { username: 'u', password: '${{ secrets.P }}' },
      env: { POSTGRES_DB: 'app' }, ports: ['5432:5432'], volumes: ['/d:/var/lib'], options: '--cpus 1',
    })).toEqual(full);
    expect(containerToYaml(full)).toMatchObject({ image: 'postgres:16', ports: ['5432:5432'] });
    expect(parseContainer({ credentials: {} })).toBeUndefined();
  });

  it('strategy matrix with vars/include/exclude and knobs; expression matrix rejects', () => {
    const raw = {
      matrix: {
        node: [18, 20], os: ['ubuntu-latest'],
        include: [{ node: 22, experimental: true }],
        exclude: [{ node: 18, os: 'ubuntu-latest' }],
      },
      'fail-fast': false, 'max-parallel': 2,
    };
    const s = parseStrategy(raw)!;
    expect(s.matrix?.vars).toEqual({ node: [18, 20], os: ['ubuntu-latest'] });
    expect(s.matrix?.include).toEqual([{ node: 22, experimental: true }]);
    expect(s.failFast).toBe(false);
    expect(s.maxParallel).toBe(2);
    expect(strategyToYaml(s)).toEqual(raw);
    expect(parseStrategy({ matrix: '${{ fromJSON(x) }}' })).toBeUndefined();
    expect(parseStrategy({ matrix: { node: 'not-a-list' } })).toBeUndefined();
  });

  it('Fix 2: wrong-typed fail-fast/max-parallel invalidates the whole strategy (not just the knob)', () => {
    expect(parseStrategy({ matrix: { node: [18] }, 'fail-fast': '${{ x }}' })).toBeUndefined();
    expect(parseStrategy({ matrix: { node: [18] }, 'max-parallel': '${{ x }}' })).toBeUndefined();
  });
});

describe('coerceScalar', () => {
  it('coerces booleans and numbers, keeps strings', () => {
    expect(coerceScalar('true')).toBe(true);
    expect(coerceScalar('false')).toBe(false);
    expect(coerceScalar('3')).toBe(3);
    expect(coerceScalar('3.5')).toBe(3.5);
    expect(coerceScalar('v3')).toBe('v3');
    expect(coerceScalar('${{ x }}')).toBe('${{ x }}');
    expect(coerceScalar('')).toBe('');
  });

  it('Fix 4: only coerces to number when the round-trip is lossless', () => {
    expect(coerceScalar('3.10')).toBe('3.10');
    expect(coerceScalar('007')).toBe('007');
    expect(coerceScalar('3.1')).toBe(3.1);
    expect(coerceScalar('3')).toBe(3);
  });
});

describe('uniqueName', () => {
  it('returns base when free, else appends an incrementing suffix', () => {
    expect(uniqueName('service', [])).toBe('service');
    expect(uniqueName('service', ['other'])).toBe('service');
    expect(uniqueName('service', ['service'])).toBe('service-2');
    expect(uniqueName('service', ['service', 'service-2'])).toBe('service-3');
  });
});
