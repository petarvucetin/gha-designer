import { stringify } from 'yaml';
import type { GraphSnapshot, JobData, Step, TriggerData, WorkflowInput, WorkflowOutput, WorkflowSecret } from './types';
import { concurrencyToYaml, containerToYaml, defaultsToYaml, environmentToYaml, permissionsToYaml, runsOnToYaml, strategyToYaml } from './mapping';

const FILTER_FIELDS: [keyof TriggerData & string, string][] = [
  ['branches', 'branches'],
  ['branchesIgnore', 'branches-ignore'],
  ['tags', 'tags'],
  ['tagsIgnore', 'tags-ignore'],
  ['paths', 'paths'],
  ['pathsIgnore', 'paths-ignore'],
];

function inputsToYaml(inputs: WorkflowInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of inputs) {
    const cfg: Record<string, unknown> = {};
    if (i.description) cfg.description = i.description;
    if (i.required != null) cfg.required = i.required;
    if (i.type) cfg.type = i.type;
    if (i.default !== undefined) cfg.default = i.default;
    if (i.options?.length) cfg.options = i.options;
    out[i.id] = cfg;
  }
  return out;
}

function outputsToYaml(outputs: WorkflowOutput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of outputs) {
    const cfg: Record<string, unknown> = {};
    if (o.description) cfg.description = o.description;
    if (o.value !== undefined) cfg.value = o.value;
    out[o.id] = cfg;
  }
  return out;
}

function secretsDeclToYaml(secrets: WorkflowSecret[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of secrets) {
    const cfg: Record<string, unknown> = {};
    if (s.description) cfg.description = s.description;
    if (s.required != null) cfg.required = s.required;
    out[s.id] = cfg;
  }
  return out;
}

function triggerConfig(t: TriggerData): unknown {
  if (t.trigger === 'schedule') {
    if (!t.cron) return [];
    const entry: Record<string, unknown> = { ...(t.extra ?? {}), cron: t.cron };
    if (t.timezone) entry.timezone = t.timezone;
    return [entry];
  }
  const cfg: Record<string, unknown> = { ...(t.extra ?? {}) };
  for (const [field, key] of FILTER_FIELDS) {
    const v = t[field] as string[] | undefined;
    if (v?.length) cfg[key] = v;
  }
  if (t.types?.length) cfg.types = t.types;
  if (t.workflows?.length) cfg.workflows = t.workflows;
  if (t.inputs?.length) cfg.inputs = inputsToYaml(t.inputs);
  if (t.outputs?.length) cfg.outputs = outputsToYaml(t.outputs);
  if (t.secretsDecl?.length) cfg.secrets = secretsDeclToYaml(t.secretsDecl);
  return cfg;
}

function stepToYaml(s: Step): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(s.extra ?? {}) };
  if (s.stepId) out.id = s.stepId;
  if (s.name) out.name = s.name;
  if (s.uses) out.uses = s.uses;
  if (s.if) out.if = s.if;
  if (s.run) out.run = s.run;
  if (s.shell) out.shell = s.shell;
  if (s.workingDirectory) out['working-directory'] = s.workingDirectory;
  if (s.with && Object.keys(s.with).length) out.with = s.with;
  if (s.env && Object.keys(s.env).length) out.env = s.env;
  if (s.continueOnError !== undefined) out['continue-on-error'] = s.continueOnError;
  if (s.timeoutMinutes != null) out['timeout-minutes'] = s.timeoutMinutes;
  return out;
}

export function toYaml(snapshot: GraphSnapshot): string {
  const { meta, nodes, edges } = snapshot;

  const on: Record<string, unknown> = {};
  for (const n of nodes) {
    if (n.data.kind !== 'trigger') continue;
    const cfg = triggerConfig(n.data);
    if (n.data.trigger === 'schedule' && Array.isArray(on.schedule)) {
      // Each schedule cron entry is its own node (see fromYaml); concatenate
      // instead of last-wins so multi-cron schedules survive export.
      on.schedule = [...(on.schedule as unknown[]), ...(cfg as unknown[])];
    } else {
      on[n.data.trigger] = cfg;
    }
  }

  const idToJob = new Map<string, JobData>();
  for (const n of nodes) {
    if (n.data.kind === 'job') idToJob.set(n.id, n.data);
  }

  const jobs: Record<string, unknown> = {};
  for (const n of nodes) {
    if (n.data.kind !== 'job') continue;
    const j = n.data;
    const needs = edges
      .filter((e) => e.target === n.id && idToJob.has(e.source))
      .map((e) => idToJob.get(e.source)!.jobId)
      .sort();
    const out: Record<string, unknown> = { ...(j.extra ?? {}) };
    if (j.name) out.name = j.name;
    if (!j.uses) out['runs-on'] = runsOnToYaml(j.runsOn);
    if (needs.length) out.needs = needs;
    if (j.if) out.if = j.if;
    if (j.permissions !== undefined) out.permissions = permissionsToYaml(j.permissions);
    if (j.uses) {
      out.uses = j.uses;
      if (j.with && Object.keys(j.with).length) out.with = j.with;
      if (j.secrets !== undefined) {
        out.secrets = j.secrets === 'inherit' ? 'inherit' : { ...j.secrets };
      }
      if (j.concurrency) out.concurrency = concurrencyToYaml(j.concurrency);
      if (j.strategy) out.strategy = strategyToYaml(j.strategy);
    } else {
      if (j.environment !== undefined) out.environment = environmentToYaml(j.environment);
      if (j.concurrency) out.concurrency = concurrencyToYaml(j.concurrency);
      if (j.outputs && Object.keys(j.outputs).length) out.outputs = j.outputs;
      if (j.env && Object.keys(j.env).length) out.env = j.env;
      if (j.defaults) out.defaults = defaultsToYaml(j.defaults);
      if (j.strategy) out.strategy = strategyToYaml(j.strategy);
      if (j.container) out.container = containerToYaml(j.container);
      if (j.services && Object.keys(j.services).length) {
        out.services = Object.fromEntries(
          Object.entries(j.services).map(([k, c]) => [k, containerToYaml(c)]),
        );
      }
      if (j.timeoutMinutes != null) out['timeout-minutes'] = j.timeoutMinutes;
      if (j.continueOnError !== undefined) out['continue-on-error'] = j.continueOnError;
      out.steps = j.steps.map(stepToYaml);
    }
    jobs[j.jobId] = out;
  }

  const doc: Record<string, unknown> = { ...(meta.extra ?? {}), name: meta.name };
  if (meta.runName) doc['run-name'] = meta.runName;
  doc.on = on;
  if (meta.permissions !== undefined) doc.permissions = permissionsToYaml(meta.permissions);
  if (meta.env && Object.keys(meta.env).length) doc.env = meta.env;
  if (meta.concurrency) doc.concurrency = concurrencyToYaml(meta.concurrency);
  if (meta.defaults) doc.defaults = defaultsToYaml(meta.defaults);
  doc.jobs = jobs;
  return stringify(doc, { indent: 2 });
}
