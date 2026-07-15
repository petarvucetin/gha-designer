export type SafeCommand = { cmd: string; args: string[] };

const RUNNER_IMAGE = 'catthehacker/ubuntu:act-latest';

/**
 * Resolve a whitelisted, safe, NON-ELEVATED setup action to a concrete command.
 * Returns null for anything not in the whitelist. No user-provided command/args
 * ever reach the shell — only the fixed entries below (engine is validated to an enum).
 */
export function resolveSetupAction(id: string, engine?: string): SafeCommand | null {
  if (id === 'podman-machine-start') return { cmd: 'podman', args: ['machine', 'start'] };
  if (id === 'pull-image' && (engine === 'docker' || engine === 'podman')) {
    return { cmd: engine, args: ['pull', RUNNER_IMAGE] };
  }
  return null;
}

/**
 * If a primary action fails, these safe follow-up commands are run in order.
 * For podman-machine-start: a first-run machine needs `init` before `start`.
 */
export const SETUP_ACTION_FALLBACK: Record<string, SafeCommand[]> = {
  'podman-machine-start': [
    { cmd: 'podman', args: ['machine', 'init'] },
    { cmd: 'podman', args: ['machine', 'start'] },
  ],
};
