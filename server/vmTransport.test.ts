// server/vmTransport.test.ts
import { describe, it, expect } from 'vitest';
import { loadVmConfig, buildSshBase, remoteWorkspace, buildScpArgs, buildRemoteScript, buildRemoteCleanup } from './vmTransport';
import type { RunRequest } from './types';

const cfg = { target: 'runner@10.0.0.5', keyPath: 'C:/k/id_ed25519', runScript: '/opt/vm/run/act-run.sh', remoteBase: '/home/runner' };
const req: RunRequest = {
  workflows: [{ fileName: 'ci.yml', yaml: 'on: push' }], target: 'ci.yml', event: 'push',
  engine: 'vm', image: 'localhost/act-runner:latest', pull: false, mode: 'container',
  secrets: { TOKEN: "s3cr#t'v" },
};
const fullReq: RunRequest = {
  ...req, event: 'workflow_dispatch', job: 'build', inputs: { a: '1' }, vars: { b: '2' }, pull: true,
};

describe('vmTransport', () => {
  it('loadVmConfig needs target+key', () => {
    expect(loadVmConfig({})).toBeNull();
    expect(loadVmConfig({ VM_SSH_TARGET: 'runner@h', VM_SSH_KEY: 'k' })).toEqual({
      target: 'runner@h', keyPath: 'k', runScript: '/opt/vm/run/act-run.sh', remoteBase: '/home/runner',
    });
  });
  it('buildSshBase is key-only, non-interactive, ends with target, has NO secret', () => {
    const a = buildSshBase(cfg);
    expect(a).toEqual(['-i', 'C:/k/id_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10', 'runner@10.0.0.5']);
    expect(a.join(' ')).not.toContain("s3cr#t");
  });
  it('remoteWorkspace + scp args target the run workspace via cwd-relative ".", no drive-letter path, no secret on argv', () => {
    const ws = remoteWorkspace(cfg, 'abc');
    expect(ws).toBe('/home/runner/ws-abc');
    const scp = buildScpArgs(cfg, ws);
    expect(scp).toContain('-r');
    expect(scp).toContain('.');
    expect(scp).toContain('runner@10.0.0.5:/home/runner/ws-abc');
    // No embedded local-dir source (the old `${localDir}/.` bug scp misparsed a Windows
    // drive letter like `C:/tmp/ws/.` as a `host:path` prefix). -i's keyPath legitimately
    // has a drive letter, so only the source/dest positional args are checked here.
    expect(scp.some((a) => /^[A-Za-z]:.*\/\.$/.test(a))).toBe(false);
    expect(scp.join(' ')).not.toContain('s3cr#t');
  });
  it('buildRemoteScript: container mode → --mode container --image; secrets in script body (stdin), safely quoted', () => {
    const s = buildRemoteScript(req, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain("export ACT_SECRETS='TOKEN'");
    expect(s).toContain("export TOKEN='s3cr#t'\\''v'"); // single-quote escaped
    expect(s).toContain(
      "exec bash /opt/vm/run/act-run.sh --workspace '/home/runner/ws-abc' --mode container " +
      "--workflow '.github/workflows/ci.yml' --event-name 'push' --pull false --image 'localhost/act-runner:latest'",
    );
  });
  it('buildRemoteScript: self-hosted mode omits --image', () => {
    const s = buildRemoteScript({ ...req, mode: 'self-hosted' }, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain(
      "--workspace '/home/runner/ws-abc' --mode self-hosted --workflow '.github/workflows/ci.yml' --event-name 'push' --pull false",
    );
    expect(s).not.toContain('--image');
  });
  it('buildRemoteScript threads event-name/pull/job/input/var, all sq()-quoted', () => {
    const s = buildRemoteScript(fullReq, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain("--event-name 'workflow_dispatch' --pull true");
    expect(s).toContain("--job 'build'");
    expect(s).toContain("--input 'a=1'");
    expect(s).toContain("--var 'b=2'");
  });
  it('buildRemoteScript neutralizes shell metacharacters in image (no breakout)', () => {
    const s = buildRemoteScript({ ...req, image: "x; touch /tmp/pwned #" }, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain("--image 'x; touch /tmp/pwned #'");
  });
  it('buildRemoteCleanup removes the workspace', () => {
    expect(buildRemoteCleanup('/home/runner/ws-abc')).toBe("rm -rf '/home/runner/ws-abc'");
  });
  it('buildRemoteScript rejects a secret name with shell metacharacters', () => {
    expect(() => buildRemoteScript({ ...req, secrets: { 'X; touch /tmp/pwned #': 'v' } }, '/home/runner/ws-abc', cfg.runScript)).toThrow(/Invalid secret name/);
  });
  it('buildRemoteScript accepts a normal identifier secret name', () => {
    expect(() => buildRemoteScript({ ...req, secrets: { GITHUB_TOKEN: 'v' } }, '/home/runner/ws-abc', cfg.runScript)).not.toThrow();
  });
  it('buildRemoteScript threads ubuntu-* labels from workflows (parity with buildActArgs), always including ubuntu-latest', () => {
    const s = buildRemoteScript(
      { ...req, workflows: [{ fileName: 'ci.yml', yaml: 'jobs:\n  build:\n    runs-on: ubuntu-22.04' }] },
      '/home/runner/ws-abc',
      cfg.runScript,
    );
    expect(s).toContain("--label 'ubuntu-latest'");
    expect(s).toContain("--label 'ubuntu-22.04'");
  });
  it('buildRemoteScript defaults to only ubuntu-latest when no workflow pins another ubuntu-* label', () => {
    const s = buildRemoteScript(req, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain("--label 'ubuntu-latest'");
    expect(s).not.toContain('ubuntu-22.04');
  });
  it('buildRemoteScript enables the artifact server via a per-run _artifacts dir under the remote workspace', () => {
    const s = buildRemoteScript(req, '/home/runner/ws-abc', cfg.runScript);
    expect(s).toContain("--artifact-path '/home/runner/ws-abc/_artifacts'");
  });
});
