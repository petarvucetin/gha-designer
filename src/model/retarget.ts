import { eventSpec } from './catalog';
import type { TriggerData } from './types';

const FILTER_FIELD_BY_KEY = {
  branches: 'branches',
  'branches-ignore': 'branchesIgnore',
  paths: 'paths',
  'paths-ignore': 'pathsIgnore',
  tags: 'tags',
  'tags-ignore': 'tagsIgnore',
} as const;

export function retargetTrigger(data: TriggerData, newEvent: string): TriggerData {
  const spec = eventSpec(newEvent);
  const next: TriggerData = { kind: 'trigger', trigger: newEvent };
  if (data.extra) next.extra = data.extra;
  for (const key of spec?.filters ?? []) {
    const field = FILTER_FIELD_BY_KEY[key];
    const v = data[field];
    if (v?.length) next[field] = v;
  }
  if (spec?.types && data.types?.length) {
    const legal = data.types.filter((t) => spec.types!.includes(t));
    if (legal.length) next.types = legal;
  }
  if (spec?.typesFree && data.types?.length) next.types = data.types;
  if (spec?.shape === 'schedule') {
    next.cron = data.cron ?? '0 4 * * *';
    if (data.timezone) next.timezone = data.timezone;
  }
  if (spec?.shape === 'dispatch' || spec?.shape === 'call') {
    if (data.inputs?.length) next.inputs = data.inputs;
  }
  if (spec?.shape === 'call') {
    if (data.outputs?.length) next.outputs = data.outputs;
    if (data.secretsDecl?.length) next.secretsDecl = data.secretsDecl;
  }
  if (spec?.shape === 'workflow_run' && data.workflows?.length) next.workflows = data.workflows;
  return next;
}
