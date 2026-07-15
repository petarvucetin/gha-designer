import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromYaml } from './fromYaml';
import { toYaml } from './toYaml';

const SAMPLE = `
name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test
        run: npm test
        continue-on-error: true
  deploy:
    runs-on: ubuntu-latest
    needs: build
    environment: prod
    steps:
      - run: ./deploy.sh
`;

describe('fromYaml', () => {
  it('parses triggers, jobs, steps and needs edges', () => {
    const s = fromYaml(SAMPLE);
    expect(s.meta.name).toBe('CI');
    const triggers = s.nodes.filter((n) => n.type === 'trigger');
    expect(triggers.map((t) => t.data.kind === 'trigger' && t.data.trigger).sort())
      .toEqual(['push', 'workflow_dispatch']);
    const push = triggers.find((t) => t.id === 'trigger:push')!;
    expect(push.data.kind === 'trigger' && push.data.branches).toEqual(['main']);

    const build = s.nodes.find((n) => n.id === 'job:build')!;
    expect(build.data.kind === 'job' && build.data.steps.length).toBe(2);
    expect(build.data.kind === 'job' && build.data.steps[1].continueOnError)
      .toBe(true);

    // needs edge deploy <- build
    expect(s.edges.some((e) => e.source === 'job:build' && e.target === 'job:deploy')).toBe(true);
    // visual edges: triggers connect to entry job (build only)
    expect(s.edges.some((e) => e.source === 'trigger:push' && e.target === 'job:build')).toBe(true);
    expect(s.edges.some((e) => e.source === 'trigger:push' && e.target === 'job:deploy')).toBe(false);
  });

  it('preserves unknown top-level and job keys in extra', () => {
    const s = fromYaml(SAMPLE);
    // permissions is now a modeled field, so it should not be in extra
    expect(s.meta.permissions).toEqual({ contents: 'read' });
    expect(s.meta.extra).toBeUndefined();
    const deploy = s.nodes.find((n) => n.id === 'job:deploy')!;
    // environment is now a modeled field, so it should not be in extra
    expect(deploy.data.kind === 'job' && deploy.data.environment).toBe('prod');
    expect(deploy.data.kind === 'job' && deploy.data.extra).toBeUndefined();
  });

  it('handles on as string and as array', () => {
    const a = fromYaml('name: x\non: push\njobs: {}');
    expect(a.nodes.filter((n) => n.type === 'trigger')).toHaveLength(1);
    const b = fromYaml('name: x\non: [push, release]\njobs: {}');
    expect(b.nodes.filter((n) => n.type === 'trigger')).toHaveLength(2);
  });

  it('handles schedule with multiple crons as one node each', () => {
    const s = fromYaml('on:\n  schedule:\n    - cron: "0 4 * * *"\n    - cron: "0 8 * * *"\njobs: {}');
    const scheds = s.nodes.filter((n) => n.data.kind === 'trigger' && n.data.trigger === 'schedule');
    expect(scheds).toHaveLength(2);
  });

  it('preserves unknown keys on schedule entries in extra', () => {
    const s = fromYaml('on:\n  schedule:\n    - cron: "0 4 * * *"\n      foo: bar\njobs: {}');
    const sched = s.nodes.find((n) => n.data.kind === 'trigger' && n.data.trigger === 'schedule')!;
    expect(sched.data.kind === 'trigger' && sched.data.cron).toBe('0 4 * * *');
    expect(sched.data.kind === 'trigger' && sched.data.extra).toEqual({ foo: 'bar' });
  });

  it('round-trips: parse(toYaml(fromYaml(x))) equals parse(x) for modeled keys', () => {
    const s = fromYaml(SAMPLE);
    const out = parse(toYaml(s));
    const orig = parse(SAMPLE);
    expect(out.name).toEqual(orig.name);
    expect(out.permissions).toEqual(orig.permissions);
    expect(out.jobs.build.steps).toEqual(orig.jobs.build.steps);
    expect(out.jobs.deploy.environment).toEqual(orig.jobs.deploy.environment);
    expect(out.jobs.deploy.needs).toEqual(['build']); // normalized to array
    expect(out.on.push.branches).toEqual(['main']);
  });

  it('dedupes duplicate needs entries into a single edge', () => {
    const s = fromYaml('on: push\njobs:\n  build:\n    runs-on: u\n    steps:\n      - run: ls\n  deploy:\n    runs-on: u\n    needs: [build, build]\n    steps:\n      - run: ls');
    const buildToDeploy = s.edges.filter((e) => e.source === 'job:build' && e.target === 'job:deploy');
    expect(buildToDeploy).toHaveLength(1);
  });

  it('throws a readable error on invalid YAML and on non-workflow docs', () => {
    expect(() => fromYaml('{ nope')).toThrow(/YAML/i);
    expect(() => fromYaml('42')).toThrow(/workflow/i);
  });
});

describe('fromYaml v2 triggers', () => {
  it('maps every kebab-case filter to camelCase and back', () => {
    const y = `on:
  push:
    branches: [main]
    branches-ignore: [tmp/*]
    tags: [v*]
    tags-ignore: [v0*]
    paths: [src/**]
    paths-ignore: [docs/**]
jobs: {}`;
    const s = fromYaml(y);
    const push = s.nodes.find((n) => n.id === 'trigger:push')!;
    expect(push.data).toMatchObject({
      branches: ['main'], branchesIgnore: ['tmp/*'], tags: ['v*'],
      tagsIgnore: ['v0*'], paths: ['src/**'], pathsIgnore: ['docs/**'],
    });
    const out = parse(toYaml(s));
    expect(out.on.push['branches-ignore']).toEqual(['tmp/*']);
    expect(out.on.push['tags-ignore']).toEqual(['v0*']);
    expect(out.on.push['paths-ignore']).toEqual(['docs/**']);
  });

  it('imports types on any catalog event and round-trips them', () => {
    const s = fromYaml('on:\n  issues:\n    types: [opened, field_added]\njobs: {}');
    const n = s.nodes.find((x) => x.id === 'trigger:issues')!;
    expect(n.data.kind === 'trigger' && n.data.types).toEqual(['opened', 'field_added']);
    expect(parse(toYaml(s)).on.issues.types).toEqual(['opened', 'field_added']);
  });

  it('accepts every zero-config catalog event as a node', () => {
    const s = fromYaml('on: [create, delete, fork, gollum, status, watch]\njobs: {}');
    expect(s.nodes.filter((n) => n.type === 'trigger')).toHaveLength(6);
  });

  it('keeps unknown event names and their config via extra', () => {
    const s = fromYaml('on:\n  totally_new_event:\n    foo: [bar]\njobs: {}');
    const n = s.nodes.find((x) => x.id === 'trigger:totally_new_event')!;
    expect(n.data.kind === 'trigger' && n.data.extra).toEqual({ foo: ['bar'] });
    expect(parse(toYaml(s)).on.totally_new_event).toEqual({ foo: ['bar'] });
  });
});

describe('fromYaml v2 special shapes', () => {
  it('round-trips workflow_dispatch inputs with types, defaults and options', () => {
    const y = `on:
  workflow_dispatch:
    inputs:
      environment:
        description: Target
        required: true
        type: choice
        options: [dev, prod]
      dry-run:
        type: boolean
        default: true
      replicas:
        type: number
        default: 3
jobs: {}`;
    const s = fromYaml(y);
    const n = s.nodes.find((x) => x.id === 'trigger:workflow_dispatch')!;
    const d = n.data;
    if (d.kind !== 'trigger') throw new Error('not trigger');
    expect(d.inputs).toEqual([
      { id: 'environment', description: 'Target', required: true, type: 'choice', options: ['dev', 'prod'] },
      { id: 'dry-run', type: 'boolean', default: true },
      { id: 'replicas', type: 'number', default: 3 },
    ]);
    const out = parse(toYaml(s));
    expect(out.on.workflow_dispatch.inputs).toEqual(parse(y).on.workflow_dispatch.inputs);
  });

  it('round-trips workflow_call inputs, outputs and secrets', () => {
    const y = `on:
  workflow_call:
    inputs:
      config-path:
        required: true
        type: string
    outputs:
      digest:
        description: Image digest
        value: \${{ jobs.build.outputs.digest }}
    secrets:
      token:
        description: PAT
        required: true
jobs: {}`;
    const s = fromYaml(y);
    const n = s.nodes.find((x) => x.id === 'trigger:workflow_call')!;
    const d = n.data;
    if (d.kind !== 'trigger') throw new Error('not trigger');
    expect(d.inputs).toEqual([{ id: 'config-path', required: true, type: 'string' }]);
    expect(d.outputs).toEqual([{ id: 'digest', description: 'Image digest', value: '${{ jobs.build.outputs.digest }}' }]);
    expect(d.secretsDecl).toEqual([{ id: 'token', description: 'PAT', required: true }]);
    expect(parse(toYaml(s)).on.workflow_call).toEqual(parse(y).on.workflow_call);
  });

  it('round-trips workflow_run workflows + types + branches', () => {
    const y = 'on:\n  workflow_run:\n    workflows: [Build, Deploy]\n    types: [completed]\n    branches: [main]\njobs: {}';
    const s = fromYaml(y);
    const n = s.nodes.find((x) => x.id === 'trigger:workflow_run')!;
    expect(n.data.kind === 'trigger' && n.data.workflows).toEqual(['Build', 'Deploy']);
    expect(parse(toYaml(s)).on.workflow_run).toEqual(parse(y).on.workflow_run);
  });

  it('round-trips schedule timezone', () => {
    const y = 'on:\n  schedule:\n    - cron: "0 4 * * *"\n      timezone: Europe/Sofia\njobs: {}';
    const s = fromYaml(y);
    const n = s.nodes.find((x) => x.id === 'trigger:schedule')!;
    expect(n.data.kind === 'trigger' && n.data.timezone).toBe('Europe/Sofia');
    expect(parse(toYaml(s)).on.schedule).toEqual([{ cron: '0 4 * * *', timezone: 'Europe/Sofia' }]);
  });
});

describe('fromYaml v2 workflow-level keys', () => {
  const Y = `name: CI
run-name: Deploy by @\${{ github.actor }}
on:
  push:
permissions:
  contents: read
  id-token: write
env:
  CI: "true"
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
defaults:
  run:
    shell: bash
    working-directory: app
jobs: {}`;

  it('parses all workflow-level keys into meta and round-trips', () => {
    const s = fromYaml(Y);
    expect(s.meta.runName).toBe('Deploy by @${{ github.actor }}');
    expect(s.meta.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    expect(s.meta.env).toEqual({ CI: 'true' });
    expect(s.meta.concurrency).toEqual({ group: 'ci-${{ github.ref }}', cancelInProgress: true });
    expect(s.meta.defaults).toEqual({ shell: 'bash', workingDirectory: 'app' });
    expect(s.meta.extra).toBeUndefined();
    const out = parse(toYaml(s));
    expect(out.name).toEqual(parse(Y).name);
    expect(out['run-name']).toEqual(parse(Y)['run-name']);
    expect(out.permissions).toEqual(parse(Y).permissions);
    expect(out.env).toEqual(parse(Y).env);
    expect(out.concurrency).toEqual(parse(Y).concurrency);
    expect(out.defaults).toEqual(parse(Y).defaults);
    expect(out.jobs).toEqual(parse(Y).jobs);
  });

  it('permissions read-all string form round-trips', () => {
    const s = fromYaml('on: push\npermissions: read-all\njobs: {}');
    expect(s.meta.permissions).toBe('read-all');
    expect(parse(toYaml(s)).permissions).toBe('read-all');
  });

  it('unmodelable defaults stay in extra untouched', () => {
    const s = fromYaml('on: push\ndefaults:\n  run:\n    shell: bash\n    odd: 1\njobs: {}');
    expect(s.meta.defaults).toBeUndefined();
    expect(s.meta.extra).toEqual({ defaults: { run: { shell: 'bash', odd: 1 } } });
    expect(parse(toYaml(s)).defaults).toEqual({ run: { shell: 'bash', odd: 1 } });
  });
});

describe('fromYaml v2 job-level part 1', () => {
  const Y = `on: push
jobs:
  deploy:
    runs-on: [self-hosted, linux]
    permissions:
      contents: read
    environment:
      name: prod
      url: \${{ steps.d.outputs.url }}
    concurrency:
      group: deploy
      cancel-in-progress: false
    outputs:
      url: \${{ steps.d.outputs.url }}
    continue-on-error: true
    defaults:
      run:
        shell: bash
    steps:
      - id: d
        run: ./deploy.sh
        continue-on-error: \${{ inputs.soft }}
        timeout-minutes: 5`;

  it('parses and round-trips all part-1 job fields and step v2 fields', () => {
    const s = fromYaml(Y);
    const j = s.nodes.find((n) => n.id === 'job:deploy')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.runsOn).toEqual(['self-hosted', 'linux']);
    expect(j.permissions).toEqual({ contents: 'read' });
    expect(j.environment).toEqual({ name: 'prod', url: '${{ steps.d.outputs.url }}' });
    expect(j.concurrency).toEqual({ group: 'deploy', cancelInProgress: false });
    expect(j.outputs).toEqual({ url: '${{ steps.d.outputs.url }}' });
    expect(j.continueOnError).toBe(true);
    expect(j.defaults).toEqual({ shell: 'bash' });
    expect(j.steps[0]).toMatchObject({
      stepId: 'd', run: './deploy.sh',
      continueOnError: '${{ inputs.soft }}', timeoutMinutes: 5,
    });
    expect(j.extra).toBeUndefined();
    expect(parse(toYaml(s)).jobs.deploy).toEqual(parse(Y).jobs.deploy);
  });

  it('runs-on group form round-trips', () => {
    const s = fromYaml('on: push\njobs:\n  a:\n    runs-on:\n      group: big\n      labels: [gpu]\n    steps:\n      - run: ls');
    const j = s.nodes.find((n) => n.id === 'job:a')!.data;
    expect(j.kind === 'job' && j.runsOn).toEqual({ group: 'big', labels: ['gpu'] });
    expect(parse(toYaml(s)).jobs.a['runs-on']).toEqual({ group: 'big', labels: ['gpu'] });
  });
});

describe('fromYaml v2 job-level part 2', () => {
  it('round-trips matrix, container and services', () => {
    const y = `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20]
        include:
          - node: 22
      fail-fast: false
    container:
      image: node:18
      env:
        A: b
    services:
      db:
        image: postgres:16
        ports: [5432]
    steps:
      - run: npm test`;
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:test')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.strategy?.matrix?.vars).toEqual({ node: [18, 20] });
    expect(j.container).toEqual({ image: 'node:18', env: { A: 'b' } });
    expect(j.services).toEqual({ db: { image: 'postgres:16', ports: ['5432'] } });
    const out = parse(toYaml(s));
    expect(out.jobs.test.strategy).toEqual(parse(y).jobs.test.strategy);
    expect(out.jobs.test.container).toEqual(parse(y).jobs.test.container);
    // ports round-trip as strings — semantically identical to GitHub
    expect(out.jobs.test.services.db.image).toBe('postgres:16');
  });

  it('round-trips reusable-workflow jobs (uses/with/secrets) with typed with-values', () => {
    const y = `on: push
jobs:
  call:
    needs: []
    uses: octo/repo/.github/workflows/build.yml@v1
    with:
      replicas: 3
      verbose: true
      env-name: prod
    secrets: inherit`;
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:call')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.uses).toBe('octo/repo/.github/workflows/build.yml@v1');
    expect(j.with).toEqual({ replicas: 3, verbose: true, 'env-name': 'prod' });
    expect(j.secrets).toBe('inherit');
    const out = parse(toYaml(s));
    expect(out.jobs.call.uses).toBe('octo/repo/.github/workflows/build.yml@v1');
    expect(out.jobs.call.with).toEqual({ replicas: 3, verbose: true, 'env-name': 'prod' });
    expect(out.jobs.call.secrets).toBe('inherit');
    expect(out.jobs.call['runs-on']).toBeUndefined();
    expect(out.jobs.call.steps).toBeUndefined();
  });

  it('secrets map form round-trips', () => {
    const y = 'on: push\njobs:\n  c:\n    uses: o/r/.github/workflows/x.yml@v1\n    secrets:\n      token: ${{ secrets.T }}';
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:c')!.data;
    expect(j.kind === 'job' && j.secrets).toEqual({ token: '${{ secrets.T }}' });
    expect(parse(toYaml(s)).jobs.c.secrets).toEqual({ token: '${{ secrets.T }}' });
  });

  it('expression-valued matrix stays in extra untouched', () => {
    const y = 'on: push\njobs:\n  m:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix: ${{ fromJSON(needs.prep.outputs.m) }}\n    steps:\n      - run: ls';
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:m')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.strategy).toBeUndefined();
    expect(j.extra?.strategy).toEqual({ matrix: '${{ fromJSON(needs.prep.outputs.m) }}' });
    expect(parse(toYaml(s)).jobs.m.strategy).toEqual({ matrix: '${{ fromJSON(needs.prep.outputs.m) }}' });
  });
});

describe('fromYaml final-review fixes', () => {
  it('Fix 1: round-trips multiple schedule cron entries without losing any but the last', () => {
    const y = 'on:\n  schedule:\n    - cron: "0 4 * * *"\n    - cron: "0 8 * * *"\njobs: {}';
    const s = fromYaml(y);
    const out = parse(toYaml(s));
    expect(out.on.schedule).toEqual([{ cron: '0 4 * * *' }, { cron: '0 8 * * *' }]);
  });

  it('Fix 2: job timeout-minutes with an expression value stays in extra and round-trips', () => {
    const y = 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: ${{ fromJSON(vars.T) }}\n    steps:\n      - run: ls';
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:build')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.timeoutMinutes).toBeUndefined();
    expect(j.extra?.['timeout-minutes']).toBe('${{ fromJSON(vars.T) }}');
    expect(parse(toYaml(s)).jobs.build['timeout-minutes']).toBe('${{ fromJSON(vars.T) }}');
  });

  it('Fix 2: scalar (non-array) branches value stays in extra and round-trips', () => {
    const y = 'on:\n  push:\n    branches: main\njobs: {}';
    const s = fromYaml(y);
    const n = s.nodes.find((x) => x.id === 'trigger:push')!;
    if (n.data.kind !== 'trigger') throw new Error('not trigger');
    expect(n.data.branches).toBeUndefined();
    expect(n.data.extra).toEqual({ branches: 'main' });
    expect(parse(toYaml(s)).on.push.branches).toBe('main');
  });

  it('Fix 2: expression-valued fail-fast pulls the whole strategy into extra and round-trips', () => {
    const y = 'on: push\njobs:\n  m:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [18, 20]\n      fail-fast: ${{ x }}\n    steps:\n      - run: ls';
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:m')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.strategy).toBeUndefined();
    expect(j.extra?.strategy).toEqual({ matrix: { node: [18, 20] }, 'fail-fast': '${{ x }}' });
    expect(parse(toYaml(s)).jobs.m.strategy).toEqual({ matrix: { node: [18, 20] }, 'fail-fast': '${{ x }}' });
  });

  it('Fix 2: step continue-on-error with a non-boolean/string value stays in extra and round-trips', () => {
    const y = 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ls\n        continue-on-error: 3';
    const s = fromYaml(y);
    const j = s.nodes.find((n) => n.id === 'job:build')!.data;
    if (j.kind !== 'job') throw new Error('not job');
    expect(j.steps[0].continueOnError).toBeUndefined();
    expect(j.steps[0].extra).toEqual({ 'continue-on-error': 3 });
    expect(parse(toYaml(s)).jobs.build.steps[0]['continue-on-error']).toBe(3);
  });

  it('Fix 3: modeled fields set after import win over stale extra values', () => {
    const y = 'on: push\njobs:\n  m:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix: ${{ fromJSON(x) }}\n    steps:\n      - run: ls';
    const s = fromYaml(y);
    const jobNode = s.nodes.find((n) => n.id === 'job:m')!;
    if (jobNode.data.kind !== 'job') throw new Error('not job');
    expect(jobNode.data.extra?.strategy).toEqual({ matrix: '${{ fromJSON(x) }}' });
    jobNode.data.strategy = { matrix: { vars: { node: [18, 20] } } };
    const out = parse(toYaml(s));
    expect(out.jobs.m.strategy).toEqual({ matrix: { node: [18, 20] } });
  });
});
