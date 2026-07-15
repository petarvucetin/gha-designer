export type FilterKey =
  | 'branches' | 'branches-ignore' | 'paths' | 'paths-ignore' | 'tags' | 'tags-ignore';

export type EventShape = 'schedule' | 'dispatch' | 'call' | 'workflow_run';

export type EventSpec = {
  name: string;
  description: string;
  types?: string[];
  typesFree?: boolean;
  filters?: FilterKey[];
  shape?: EventShape;
};

const PR_TYPES = [
  'assigned', 'unassigned', 'labeled', 'unlabeled', 'opened', 'edited', 'closed',
  'reopened', 'synchronize', 'converted_to_draft', 'locked', 'unlocked', 'enqueued',
  'dequeued', 'milestoned', 'demilestoned', 'ready_for_review', 'review_requested',
  'review_request_removed', 'auto_merge_enabled', 'auto_merge_disabled',
];
const PR_FILTERS: FilterKey[] = ['branches', 'branches-ignore', 'paths', 'paths-ignore'];

export const EVENTS: EventSpec[] = [
  { name: 'branch_protection_rule', description: 'Branch protection rule changed', types: ['created', 'edited', 'deleted'] },
  { name: 'check_run', description: 'Check run activity', types: ['created', 'rerequested', 'completed', 'requested_action'] },
  { name: 'check_suite', description: 'Check suite completed', types: ['completed'] },
  { name: 'create', description: 'Branch or tag created' },
  { name: 'delete', description: 'Branch or tag deleted' },
  { name: 'deployment', description: 'Deployment created' },
  { name: 'deployment_status', description: 'Deployment status changed' },
  { name: 'discussion', description: 'Discussion activity', types: ['created', 'edited', 'deleted', 'transferred', 'pinned', 'unpinned', 'labeled', 'unlabeled', 'locked', 'unlocked', 'category_changed', 'answered', 'unanswered'] },
  { name: 'discussion_comment', description: 'Discussion comment activity', types: ['created', 'edited', 'deleted'] },
  { name: 'fork', description: 'Repository forked' },
  { name: 'gollum', description: 'Wiki page updated' },
  { name: 'issue_comment', description: 'Issue/PR comment activity', types: ['created', 'edited', 'deleted'] },
  { name: 'issues', description: 'Issue activity', types: ['opened', 'edited', 'deleted', 'transferred', 'pinned', 'unpinned', 'closed', 'reopened', 'assigned', 'unassigned', 'labeled', 'unlabeled', 'locked', 'unlocked', 'milestoned', 'demilestoned', 'typed', 'untyped', 'field_added', 'field_removed'] },
  { name: 'label', description: 'Label activity', types: ['created', 'edited', 'deleted'] },
  { name: 'merge_group', description: 'Merge queue group', types: ['checks_requested'], filters: ['branches', 'branches-ignore'] },
  { name: 'milestone', description: 'Milestone activity', types: ['created', 'closed', 'opened', 'edited', 'deleted'] },
  { name: 'page_build', description: 'GitHub Pages build' },
  { name: 'public', description: 'Repository made public' },
  { name: 'pull_request', description: 'Pull request activity', types: PR_TYPES, filters: PR_FILTERS },
  { name: 'pull_request_review', description: 'PR review activity', types: ['submitted', 'edited', 'dismissed'] },
  { name: 'pull_request_review_comment', description: 'PR review comment activity', types: ['created', 'edited', 'deleted'] },
  { name: 'pull_request_target', description: 'PR activity (base-repo context)', types: PR_TYPES, filters: PR_FILTERS },
  { name: 'push', description: 'Push to branches or tags', filters: ['branches', 'branches-ignore', 'tags', 'tags-ignore', 'paths', 'paths-ignore'] },
  { name: 'registry_package', description: 'Package registry activity', types: ['published', 'updated'] },
  { name: 'release', description: 'Release activity', types: ['published', 'unpublished', 'created', 'edited', 'deleted', 'prereleased', 'released'] },
  { name: 'repository_dispatch', description: 'External webhook dispatch', typesFree: true },
  { name: 'schedule', description: 'Cron schedule', shape: 'schedule' },
  { name: 'status', description: 'Commit status changed' },
  { name: 'watch', description: 'Repository starred', types: ['started'] },
  { name: 'workflow_call', description: 'Reusable workflow entry point', shape: 'call' },
  { name: 'workflow_dispatch', description: 'Manual run', shape: 'dispatch' },
  { name: 'workflow_run', description: 'Another workflow ran', types: ['completed', 'requested', 'in_progress'], shape: 'workflow_run', filters: ['branches', 'branches-ignore'] },
];

export function eventSpec(name: string): EventSpec | undefined {
  return EVENTS.find((e) => e.name === name);
}

export type PermissionValue = 'read' | 'write' | 'none';

const RWN: PermissionValue[] = ['read', 'write', 'none'];

export const PERMISSION_SCOPES: { name: string; values: PermissionValue[] }[] = [
  { name: 'actions', values: RWN },
  { name: 'attestations', values: RWN },
  { name: 'checks', values: RWN },
  { name: 'contents', values: RWN },
  { name: 'deployments', values: RWN },
  { name: 'discussions', values: RWN },
  { name: 'id-token', values: ['write', 'none'] },
  { name: 'issues', values: RWN },
  { name: 'models', values: ['read', 'none'] },
  { name: 'packages', values: RWN },
  { name: 'pages', values: RWN },
  { name: 'pull-requests', values: RWN },
  { name: 'security-events', values: RWN },
  { name: 'statuses', values: RWN },
];

export const RUNNER_LABELS: string[] = [
  'ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'ubuntu-24.04-arm',
  'ubuntu-22.04-arm', 'ubuntu-slim', 'windows-latest', 'windows-2025',
  'windows-2022', 'windows-11-arm', 'macos-latest', 'macos-15', 'macos-14',
  'macos-15-intel', 'self-hosted',
];

export const SHELLS: string[] = ['bash', 'pwsh', 'python', 'sh', 'cmd', 'powershell'];
