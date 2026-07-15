import { eventSpec } from './catalog';
import type { NodeData, Step } from './types';
import { freshId } from './types';

export interface PaletteItem {
  label: string;
  description: string;
  make(): NodeData;
}

export function makeTriggerNode(name: string): NodeData {
  const base = { kind: 'trigger' as const, trigger: name };
  if (name === 'schedule') return { ...base, cron: '0 4 * * *' };
  if (name === 'push' || name === 'pull_request' || name === 'pull_request_target') return { ...base, branches: ['main'] };
  if (name === 'release') return { ...base, types: ['published'] };
  return base;
}

function triggerItem(name: string): PaletteItem {
  return { label: name, description: eventSpec(name)?.description ?? name, make: () => makeTriggerNode(name) };
}

// Every GitHub Actions event from catalog.ts EVENTS, grouped for the palette.
// Each event appears in EXACTLY ONE group — see presets.test.ts for the coverage check.
export const TRIGGER_GROUPS: { label: string; items: PaletteItem[] }[] = [
  { label: 'Common CI',              items: ['push','pull_request','workflow_dispatch','schedule','release'].map(triggerItem) },
  { label: 'Pull requests & reviews',items: ['pull_request_target','pull_request_review','pull_request_review_comment','merge_group'].map(triggerItem) },
  { label: 'Branches, tags & repo',  items: ['create','delete','fork','gollum','public','watch'].map(triggerItem) },
  { label: 'Issues & discussions',   items: ['issues','issue_comment','discussion','discussion_comment','label','milestone'].map(triggerItem) },
  { label: 'Checks & status',        items: ['check_run','check_suite','status','branch_protection_rule'].map(triggerItem) },
  { label: 'Deploys & packages',     items: ['deployment','deployment_status','registry_package','page_build'].map(triggerItem) },
  { label: 'Automation & reusable',  items: ['repository_dispatch','workflow_call','workflow_run'].map(triggerItem) },
];

export const JOB_PRESETS: PaletteItem[] = [
  {
    label: 'blank job',
    description: 'Empty job with one run step',
    make: () => ({
      kind: 'job', jobId: 'new-job', runsOn: 'ubuntu-latest',
      steps: [{ id: freshId('step'), name: 'Hello', run: 'echo hello' }],
    }),
  },
  {
    label: 'build (node)',
    description: 'Checkout, setup-node, install, test',
    make: () => ({
      kind: 'job', jobId: 'build', name: 'Build & Test', runsOn: 'ubuntu-latest',
      steps: [
        { id: freshId('step'), uses: 'actions/checkout@v4' },
        { id: freshId('step'), name: 'Setup Node', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } },
        { id: freshId('step'), name: 'Install', run: 'npm ci' },
        { id: freshId('step'), name: 'Test', run: 'npm test' },
      ] as Step[],
    }),
  },
  {
    label: 'docker build & push',
    description: 'Buildx + login + push',
    make: () => ({
      kind: 'job', jobId: 'docker', name: 'Docker Build', runsOn: 'ubuntu-latest',
      steps: [
        { id: freshId('step'), uses: 'actions/checkout@v4' },
        { id: freshId('step'), name: 'Set up Buildx', uses: 'docker/setup-buildx-action@v3' },
        { id: freshId('step'), name: 'Login', uses: 'docker/login-action@v3', with: { username: '${{ secrets.DOCKER_USER }}', password: '${{ secrets.DOCKER_TOKEN }}' } },
        { id: freshId('step'), name: 'Build & push', uses: 'docker/build-push-action@v6', with: { push: 'true', tags: 'user/app:latest' } },
      ] as Step[],
    }),
  },
  {
    label: 'deploy',
    description: 'Deploy script gated on success',
    make: () => ({
      kind: 'job', jobId: 'deploy', name: 'Deploy', runsOn: 'ubuntu-latest',
      if: "github.ref == 'refs/heads/main'",
      steps: [
        { id: freshId('step'), uses: 'actions/checkout@v4' },
        { id: freshId('step'), name: 'Deploy', run: './deploy.sh' },
      ],
    }),
  },
];

export interface ActionPaletteItem {
  label: string;
  description: string;
  makeStep(): Step;
}

// Curated subset of popular GitHub Marketplace actions. Double-clicking one
// inserts a single `uses:` step into a job (see Palette.tsx / store.addActionStep) —
// unlike TRIGGER_GROUPS/JOB_PRESETS, these are not whole nodes.
export const ACTION_PRESETS: ActionPaletteItem[] = [
  {
    label: 'actions/checkout',
    description: 'Check out the repository',
    makeStep: () => ({ id: freshId('step'), uses: 'actions/checkout@v4' }),
  },
  {
    label: 'actions/setup-node',
    description: 'Set up a Node.js environment',
    makeStep: () => ({ id: freshId('step'), name: 'Setup Node', uses: 'actions/setup-node@v4', with: { 'node-version': '20' } }),
  },
  {
    label: 'actions/setup-python',
    description: 'Set up a Python environment',
    makeStep: () => ({ id: freshId('step'), name: 'Setup Python', uses: 'actions/setup-python@v5', with: { 'python-version': '3.12' } }),
  },
  {
    label: 'actions/setup-java',
    description: 'Set up a Java (JDK) environment',
    makeStep: () => ({
      id: freshId('step'), name: 'Setup Java', uses: 'actions/setup-java@v4',
      with: { distribution: 'temurin', 'java-version': '21' },
    }),
  },
  {
    label: 'actions/setup-go',
    description: 'Set up a Go environment',
    makeStep: () => ({ id: freshId('step'), name: 'Setup Go', uses: 'actions/setup-go@v5', with: { 'go-version': 'stable' } }),
  },
  {
    label: 'actions/cache',
    description: 'Cache dependencies and build outputs',
    makeStep: () => ({
      id: freshId('step'), name: 'Cache', uses: 'actions/cache@v4',
      with: { path: '~/.cache', key: "${{ runner.os }}-cache-${{ hashFiles('**/lockfile') }}" },
    }),
  },
  {
    label: 'actions/upload-artifact',
    description: 'Upload a build artifact',
    makeStep: () => ({
      id: freshId('step'), name: 'Upload artifact', uses: 'actions/upload-artifact@v4',
      with: { name: 'artifact', path: 'dist' },
    }),
  },
  {
    label: 'actions/download-artifact',
    description: 'Download a build artifact',
    makeStep: () => ({ id: freshId('step'), name: 'Download artifact', uses: 'actions/download-artifact@v4', with: { name: 'artifact' } }),
  },
  {
    label: 'docker/setup-buildx-action',
    description: 'Set up Docker Buildx',
    makeStep: () => ({ id: freshId('step'), name: 'Set up Buildx', uses: 'docker/setup-buildx-action@v3' }),
  },
  {
    label: 'docker/login-action',
    description: 'Log in to a container registry',
    makeStep: () => ({
      id: freshId('step'), name: 'Login', uses: 'docker/login-action@v3',
      with: { username: '${{ secrets.DOCKER_USER }}', password: '${{ secrets.DOCKER_TOKEN }}' },
    }),
  },
  {
    label: 'docker/build-push-action',
    description: 'Build and push a Docker image',
    makeStep: () => ({
      id: freshId('step'), name: 'Build & push', uses: 'docker/build-push-action@v6',
      with: { push: 'true', tags: 'user/app:latest' },
    }),
  },
  {
    label: 'actions/github-script',
    description: 'Run a script with the GitHub API/context',
    makeStep: () => ({
      id: freshId('step'), name: 'Run script', uses: 'actions/github-script@v7',
      with: { script: 'console.log("hello")' },
    }),
  },
];

/**
 * Derive a job id from a pasted reusable-workflow `uses:` ref.
 * Prefers the workflow filename (without extension); falls back to the last
 * path segment, then to a generic default when nothing usable is found.
 */
export function jobIdFromRef(ref: string): string {
  const r = ref.trim();
  // strip a trailing @ref, take the workflow filename without extension if present
  const noRef = r.split('@')[0];
  const m = noRef.match(/([^/\\]+)\.ya?ml$/);
  if (m) return m[1];                     // ci.yml -> "ci"
  const seg = noRef.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop();
  return seg || 'reusable';               // fallback
}

/** Build a single action step from a pasted `uses:` ref (owner/action@v4, docker://…, ./local-action). */
export function makeActionStepFromRef(ref: string): Step {
  return { id: freshId('step'), uses: ref.trim() };
}

/** Build a job node that calls a reusable workflow referenced by a pasted `uses:` ref. */
export function makeReusableWorkflowNode(ref: string): NodeData {
  return { kind: 'job', jobId: jobIdFromRef(ref), runsOn: '', steps: [], uses: ref.trim() };
}
