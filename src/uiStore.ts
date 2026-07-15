import { create } from 'zustand';

export type SidebarTab = 'config' | 'yaml' | 'problems' | 'help';
export type StepFocus = { nodeId: string; stepId: string; stamp: number };
export type ActiveView = 'workflow' | 'run';
export type NoticeKind = 'info' | 'error';
export type Notice = { msg: string; kind: NoticeKind; token: number };

type UiState = {
  sidebarTab: SidebarTab;
  setSidebarTab(tab: SidebarTab): void;
  stepFocus: StepFocus | null;
  focusStep(nodeId: string, stepId: string): void;
  consumeStepFocus(): void;
  activeView: ActiveView;
  showRun(): void;
  showWorkflow(): void;
  notice: Notice | null;
  setNotice(msg: string, kind?: NoticeKind): void;
  clearNotice(token?: number): void;
};

let stamp = 0;
let noticeToken = 0;

export const useUi = create<UiState>((set) => ({
  sidebarTab: 'config',
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
  stepFocus: null,
  focusStep: (nodeId, stepId) => {
    stamp += 1;
    set({ sidebarTab: 'config', stepFocus: { nodeId, stepId, stamp } });
  },
  consumeStepFocus: () => set({ stepFocus: null }),
  activeView: 'workflow',
  showRun: () => set({ activeView: 'run' }),
  showWorkflow: () => set({ activeView: 'workflow' }),
  notice: null,
  setNotice: (msg, kind = 'info') => {
    noticeToken += 1;
    set({ notice: { msg, kind, token: noticeToken } });
  },
  clearNotice: (token) => set((s) => {
    if (token === undefined || s.notice?.token === token) return { notice: null };
    return {};
  }),
}));
