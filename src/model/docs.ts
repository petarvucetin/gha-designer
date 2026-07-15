import { eventSpec } from './catalog';

export const EVENTS_DOCS_URL =
  'https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows';
export const SYNTAX_DOCS_URL =
  'https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax';

export function eventDocsUrl(name: string): string {
  return `${EVENTS_DOCS_URL}#${name}`;
}

export const EVENT_HELP: Record<string, string> = {
  branch_protection_rule: 'Fires when a branch protection rule is created, edited or deleted. Useful for auditing repository security settings.',
  check_run: 'Fires on check run activity (created, rerequested, completed, requested_action). Integrates external CI/check tooling.',
  check_suite: 'Fires when a check suite completes. Use to react to the overall result of a set of checks.',
  create: 'Fires when a branch or tag is created. No filters — use an if condition on github.ref to narrow.',
  delete: 'Fires when a branch or tag is deleted. Handy for cleanup workflows (environments, caches, preview deploys).',
  deployment: 'Fires when a deployment is created via the Deployments API. Drives external deploy tooling.',
  deployment_status: 'Fires when a deployment status is updated by a deploy provider. Use to notify or gate follow-ups.',
  discussion: 'Fires on GitHub Discussions activity — created, edited, answered, labeled and more. Repo discussions only.',
  discussion_comment: 'Fires when a comment on a discussion is created, edited or deleted.',
  fork: 'Fires when someone forks the repository. Often used for community metrics or notifications.',
  gollum: 'Fires when a wiki page is created or updated.',
  issue_comment: 'Fires on comments on issues AND pull requests. Check github.event.issue.pull_request to tell them apart.',
  issues: 'Fires on issue activity — opened, labeled, assigned, closed and many more. Pick activity types to narrow.',
  label: 'Fires when a repository label is created, edited or deleted.',
  merge_group: 'Fires when a merge queue groups PRs for validation (checks_requested). Required for repos using merge queues.',
  milestone: 'Fires on milestone activity — created, opened, closed, edited, deleted.',
  page_build: 'Fires when a GitHub Pages site finishes building (pushes to the publishing branch).',
  public: 'Fires when a private repository is made public. Good hook for compliance checks.',
  pull_request: 'Fires on PR activity in the merge-ref context. Defaults to opened/synchronize/reopened; pick types and branch/path filters to narrow. Secrets are limited for fork PRs.',
  pull_request_review: 'Fires when a PR review is submitted, edited or dismissed.',
  pull_request_review_comment: 'Fires on comments made on a PR diff (review comments).',
  pull_request_target: 'Like pull_request but runs in the BASE repository context with access to secrets. Use with care — never run untrusted PR code in this context.',
  push: 'Fires on pushed commits to branches or tags. Filter with branches/tags/paths (and their -ignore variants) to control when it runs.',
  registry_package: 'Fires when a package is published or updated in GitHub Packages.',
  release: 'Fires on release activity — published, created, prereleased and more. published is the most common type for deploy workflows.',
  repository_dispatch: 'Fires when an external system POSTs a custom event to the repository dispatch API. Define your own event types.',
  schedule: 'Runs the workflow on a cron schedule (UTC by default; timezone supported). Shortest interval is every 5 minutes; runs only on the default branch.',
  status: 'Fires when a commit status changes (external CI reporting). Runs on the default branch.',
  watch: 'Fires when someone stars the repository (type: started).',
  workflow_call: 'Marks this workflow as reusable: other workflows call it with jobs.<id>.uses, passing declared inputs and secrets and reading declared outputs.',
  workflow_dispatch: 'Adds a manual "Run workflow" button (and API endpoint). Declare typed inputs the runner receives via the inputs context.',
  workflow_run: 'Fires when another workflow starts or completes. Chain follow-up work (e.g. publish after CI) across workflow files.',
};

export function eventHelp(name: string): string {
  return EVENT_HELP[name]
    ?? eventSpec(name)?.description
    ?? 'A GitHub event not in this editor\'s catalog. It is exported to YAML exactly as imported.';
}

export type SyntaxTopic = { key: string; title: string; help: string; anchor: string };

export const SYNTAX_TOPICS: SyntaxTopic[] = [
  { key: 'name', title: 'name', anchor: 'name', help: 'Display name of the workflow, shown in the Actions tab. Optional — defaults to the file path.' },
  { key: 'run-name', title: 'run-name', anchor: 'run-name', help: 'Name for each run, may use expressions like github.actor. Shown in the run list.' },
  { key: 'on', title: 'on (triggers)', anchor: 'on', help: 'The events that start this workflow. Trigger nodes on the canvas union into this block.' },
  { key: 'permissions', title: 'permissions', anchor: 'permissions', help: 'Scopes granted to the GITHUB_TOKEN. Set read-all, write-all, or per-scope values; anything unset is none. Least privilege is the security best practice.' },
  { key: 'env', title: 'env', anchor: 'env', help: 'Environment variables available to every job and step (workflow level) or to one job/step at lower levels.' },
  { key: 'defaults', title: 'defaults.run', anchor: 'defaultsrun', help: 'Default shell and working-directory applied to all run steps that do not set their own.' },
  { key: 'concurrency', title: 'concurrency', anchor: 'concurrency', help: 'One run per group: new runs queue behind (or cancel, with cancel-in-progress) an in-flight run of the same group.' },
  { key: 'jobs', title: 'jobs', anchor: 'jobs', help: 'Units of work that run on their own runner. Jobs run in parallel unless ordered with needs (wires between job nodes).' },
  { key: 'needs', title: 'needs', anchor: 'jobsjob_idneeds', help: 'Job dependencies — this job waits for the listed jobs to succeed. Drawn as wires between job nodes on the canvas.' },
  { key: 'runs-on', title: 'runs-on', anchor: 'jobsjob_idruns-on', help: 'The runner for the job: a GitHub-hosted label (ubuntu-latest, windows-latest, …), a label list for self-hosted matching, or a runner group.' },
  { key: 'environment', title: 'environment', anchor: 'jobsjob_idenvironment', help: 'Deployment environment this job targets. Environments can require reviewers and hold environment-scoped secrets; the url shows on the deployment.' },
  { key: 'outputs', title: 'outputs', anchor: 'jobsjob_idoutputs', help: 'Values this job exposes to dependent jobs via needs.<job>.outputs.<name>, usually from step outputs.' },
  { key: 'timeout-minutes', title: 'timeout-minutes', anchor: 'jobsjob_idtimeout-minutes', help: 'Maximum minutes before the job (or step) is cancelled. Default is 360 for jobs.' },
  { key: 'matrix', title: 'strategy.matrix', anchor: 'jobsjob_idstrategymatrix', help: 'Runs the job once per combination of the variables. include/exclude add or remove combinations; fail-fast and max-parallel tune execution.' },
  { key: 'continue-on-error', title: 'continue-on-error', anchor: 'jobsjob_idcontinue-on-error', help: 'Marks the workflow green even if this job/step fails. Also accepts an expression.' },
  { key: 'container', title: 'container', anchor: 'jobsjob_idcontainer', help: 'Runs all steps of the job inside this Docker image instead of directly on the runner (Linux runners only).' },
  { key: 'services', title: 'services', anchor: 'jobsjob_idservices', help: 'Sidecar containers (databases, caches) started for the job and reachable from the steps via the mapped ports.' },
  { key: 'uses', title: 'uses (reusable workflow)', anchor: 'jobsjob_iduses', help: 'Calls another workflow file as this job: owner/repo/.github/workflows/file.yml@ref. The called workflow declares its inputs via workflow_call. Workflows open in other tabs can be called locally as ./.github/workflows/<file> — pick them from the local dropdown.' },
  { key: 'with', title: 'with', anchor: 'jobsjob_idwith', help: 'Inputs passed to the called reusable workflow. Types (string/number/boolean) must match its workflow_call declarations.' },
  { key: 'secrets', title: 'secrets', anchor: 'jobsjob_idsecrets', help: 'Secrets passed to the called workflow — name them explicitly or pass "inherit" to forward all of the caller\'s secrets.' },
  { key: 'steps', title: 'steps', anchor: 'jobsjob_idsteps', help: 'The ordered commands of a job: each step either runs a shell command (run) or an action (uses). Steps share the runner filesystem.' },
  { key: 'run', title: 'run locally', anchor: '', help: 'The run button executes this workflow on your machine with nektos/act inside Docker or Podman containers. Pick the event, engine and runner image in the run dialog; logs stream into the run panel and job nodes show live status.' },
];

export function topic(key: string): SyntaxTopic | undefined {
  return SYNTAX_TOPICS.find((t) => t.key === key);
}

export function topicUrl(key: string): string {
  return `${SYNTAX_DOCS_URL}#${topic(key)?.anchor ?? ''}`;
}
