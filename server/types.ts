// server/types.ts
export type RunRequest = {
  workflows: { fileName: string; yaml: string }[];
  target: string;
  event: string;
  job?: string;
  inputs?: Record<string, string>;
  secrets?: Record<string, string>;
  vars?: Record<string, string>;
  engine: 'docker' | 'podman' | 'vm';
  mode?: 'self-hosted' | 'container';
  image: string;
  pull: boolean;
  cancelPrevious?: boolean;
  sourceRoot?: string;
};

export type JobStatus = 'running' | 'success' | 'failure' | 'cancelled' | 'skipped';

export type RunEvent =
  | { kind: 'line'; jobId?: string; step?: string; level: string; msg: string; repeat?: number }
  | { kind: 'status'; scope: 'job' | 'step'; jobId: string; step?: string; status: JobStatus }
  | { kind: 'phase'; status: 'running' | 'success' | 'failure' | 'cancelled' | 'error'; exitCode?: number };

export type EngineInfo = { available: boolean; version?: string; hint?: string };
export type EnginesReport = {
  act: EngineInfo & { path?: string };
  docker: EngineInfo;
  podman: EngineInfo & { socket?: string };
  vm: EngineInfo;
};

export type RunSummary = {
  id: string;
  status: 'running' | 'success' | 'failure' | 'cancelled' | 'error';
  event: string;
  engine: string;
  target: string;
  startedAt: number;
  finishedAt?: number;
};

export type ExecFn = (
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;
