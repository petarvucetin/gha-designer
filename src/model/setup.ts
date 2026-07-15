/**
 * Guided "get ready to run" setup: tiered engine paths, their guidance steps, a sample
 * workflow, and readiness computed from the runner server's /api/engines report.
 *
 * Deliberately decoupled from runStore's EnginesReport type — EnginesLike below is
 * structurally compatible so this module has no import-time dependency on the store.
 */

export const SAMPLE_WORKFLOW = `name: hello
on: [workflow_dispatch]
jobs:
  hello:
    runs-on: ubuntu-latest
    steps:
      - name: Say hello
        run: echo "Hello from your local runner! 🎉"
      - name: Show tools
        run: |
          echo "node: $(node --version 2>/dev/null || echo n/a)"
          echo "git:  $(git --version 2>/dev/null || echo n/a)"
`;

export type EngineStatus = { available: boolean; version?: string; hint?: string };
export type EnginesLike = { act: EngineStatus; docker: EngineStatus; podman: EngineStatus; vm: EngineStatus };

export type GuidanceStep = { text: string; command?: string; link?: string; elevated?: boolean };

export type SetupPath = {
  id: 'docker' | 'podman' | 'vm';
  label: string;
  blurb: string; // one line: what it is / when to pick it
  constraints: string; // the tradeoff
  fidelity: number; // higher = more faithful (docker=1, podman=1, vm=3) — for recommendation ordering
  ready(e: EnginesLike): boolean;
  steps: GuidanceStep[]; // shown when NOT ready
};

export const SETUP_PATHS: SetupPath[] = [
  {
    id: 'docker',
    label: 'Docker (container)',
    blurb: 'Easiest to set up — runs each job inside a container image. Great for most workflows.',
    constraints: 'Container fidelity — not a full VM (no systemd / nested-VM specifics).',
    fidelity: 1,
    ready: (e) => e.docker.available,
    steps: [
      { text: 'Install Docker Desktop', link: 'https://www.docker.com/products/docker-desktop/' },
      { text: "If it's already installed, make sure Docker Desktop is running." },
    ],
  },
  {
    id: 'podman',
    label: 'Podman (container)',
    blurb: 'A lighter, license-free alternative to Docker. Runs jobs in a container.',
    constraints: 'Container fidelity, same as Docker.',
    fidelity: 1,
    ready: (e) => e.podman.available,
    steps: [
      { text: 'Install Podman', command: 'winget install RedHat.Podman', link: 'https://podman.io/' },
      { text: 'Start the Podman machine', command: 'podman machine init && podman machine start' },
    ],
  },
  {
    id: 'vm',
    label: 'Hyper-V VM (self-hosted)',
    blurb: "Highest fidelity — steps run on a real Linux VM, closest to GitHub's hosted runner.",
    constraints: 'Windows Pro + admin, Hyper-V, more resources, longest setup.',
    fidelity: 3,
    ready: (e) => e.vm.available,
    steps: [
      {
        text: 'Enable Hyper-V, then reboot',
        command: 'Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All',
        elevated: true,
      },
      { text: 'Build & start the runner VM image (see the vm/ folder scripts).' },
      { text: 'The app connects to the VM over SSH once it is running.' },
    ],
  },
];

export type SetupReadiness = {
  paths: (Omit<SetupPath, 'ready'> & { ready: boolean })[];
  anyReady: boolean;
  recommended: SetupPath['id'] | null; // best-ready by fidelity; if none ready → 'docker' (easiest to set up)
  actReady: boolean;
};

export function computeSetup(engines: EnginesLike | undefined): SetupReadiness {
  const paths = SETUP_PATHS.map((p) => ({ ...p, ready: engines ? p.ready(engines) : false }));
  const readyPaths = paths.filter((p) => p.ready);
  const anyReady = readyPaths.length > 0;
  const best = readyPaths.slice().sort((a, b) => b.fidelity - a.fidelity)[0];
  return {
    paths,
    anyReady,
    recommended: best ? best.id : 'docker',
    actReady: engines ? engines.act.available : false,
  };
}
