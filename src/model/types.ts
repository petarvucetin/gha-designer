export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'choice' | 'environment';
export type WorkflowInput = {
  id: string;
  type?: WorkflowInputType;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: string[];
};
export type WorkflowOutput = { id: string; description?: string; value?: string };
export type WorkflowSecret = { id: string; description?: string; required?: boolean };
export type Permissions = 'read-all' | 'write-all' | Record<string, 'read' | 'write' | 'none'>;
export type Concurrency = { group: string; cancelInProgress?: boolean | string };
export type RunDefaults = { shell?: string; workingDirectory?: string };
export type RunsOn = string | string[] | { group: string; labels?: string[] };
export type JobEnvironment = string | { name: string; url?: string };
export type Container = {
  image: string;
  credentials?: { username?: string; password?: string };
  env?: Record<string, string>;
  ports?: string[];
  volumes?: string[];
  options?: string;
};
export type MatrixStrategy = {
  matrix?: {
    vars: Record<string, unknown[]>;
    include?: Record<string, unknown>[];
    exclude?: Record<string, unknown>[];
  };
  failFast?: boolean;
  maxParallel?: number;
};

// NOTE: these are `type` aliases, not `interface`s, on purpose: React Flow v12's
// Node<T> generic requires T to satisfy Record<string, unknown>, and TypeScript
// grants implicit index signatures to object type aliases but not to interfaces.
export type TriggerData = {
  kind: 'trigger';
  trigger: string;
  branches?: string[];
  branchesIgnore?: string[];
  paths?: string[];
  pathsIgnore?: string[];
  tags?: string[];
  tagsIgnore?: string[];
  types?: string[];
  cron?: string;
  timezone?: string;
  inputs?: WorkflowInput[];
  outputs?: WorkflowOutput[];
  secretsDecl?: WorkflowSecret[];
  workflows?: string[];
  extra?: Record<string, unknown>;
};

export type Step = {
  id: string;
  stepId?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  if?: string;
  shell?: string;
  workingDirectory?: string;
  continueOnError?: boolean | string;
  timeoutMinutes?: number;
  extra?: Record<string, unknown>;
};

export type JobData = {
  kind: 'job';
  jobId: string;
  name?: string;
  runsOn: RunsOn;
  if?: string;
  env?: Record<string, string>;
  timeoutMinutes?: number;
  permissions?: Permissions;
  environment?: JobEnvironment;
  concurrency?: Concurrency;
  outputs?: Record<string, string>;
  continueOnError?: boolean | string;
  defaults?: RunDefaults;
  strategy?: MatrixStrategy;
  container?: Container;
  services?: Record<string, Container>;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, string> | 'inherit';
  steps: Step[];
  extra?: Record<string, unknown>;
};

export type NodeData = TriggerData | JobData;

export interface GraphNode {
  id: string;
  type: 'trigger' | 'job';
  position: { x: number; y: number };
  data: NodeData;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export type WorkflowMeta = {
  name: string;
  runName?: string;
  permissions?: Permissions;
  env?: Record<string, string>;
  concurrency?: Concurrency;
  defaults?: RunDefaults;
  extra?: Record<string, unknown>;
};

export interface GraphSnapshot {
  meta: WorkflowMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type WorkflowDoc = {
  id: string;
  fileName: string;
  meta: WorkflowMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  source?: { root: string; path: string; diskHash: string };
  sourceRt?: { baseline: string; conflict: boolean; detached: boolean; mtimeMs: number; hadComments: boolean };
};

export interface Problem {
  severity: 'error' | 'warning';
  nodeId?: string;
  message: string;
}

let counter = 0;
export function freshId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}
