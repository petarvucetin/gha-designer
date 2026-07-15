import { useCallback, useEffect } from 'react';
import {
  Background, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DragEvent } from 'react';
import type { NodeData, Step } from '../model/types';
import { useEditor } from '../store';
import { useRun } from '../runStore';
import { useSaved } from '../savedStore';
import { useUi } from '../uiStore';
import { resolveDroppedUrl } from '../lib/resolveRef';
import { makeActionStepFromRef, makeReusableWorkflowNode } from '../model/presets';
import TriggerNode from './TriggerNode';
import JobNode from './JobNode';

const nodeTypes = { trigger: TriggerNode, job: JobNode };

export default function FlowCanvas() {
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const onNodesChange = useEditor((s) => s.onNodesChange);
  const onEdgesChange = useEditor((s) => s.onEdgesChange);
  const onConnect = useEditor((s) => s.onConnect);
  const addNode = useEditor((s) => s.addNode);
  const addActionStep = useEditor((s) => s.addActionStep);
  const addSaved = useSaved((s) => s.addSaved);
  const setNotice = useUi((s) => s.setNotice);
  const setSelected = useEditor((s) => s.setSelected);
  const layoutStamp = useEditor((s) => s.layoutStamp);
  const runOpen = useRun((s) => s.activeRun !== null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const handleConnect = useCallback((c: Connection) => { onConnect(c); }, [onConnect]);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/gha-node');
    if (raw) {
      const data = JSON.parse(raw) as NodeData;
      addNode(data, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      return;
    }
    const rawStep = e.dataTransfer.getData('application/gha-action-step');
    if (rawStep) {
      const step = JSON.parse(rawStep) as Step;
      // Dropping directly on a job node's DOM element targets that job; anywhere
      // else (empty canvas, a trigger node) falls back to addActionStep's own
      // selected-job/only-job/create-job resolution.
      const jobId = (e.target as HTMLElement).closest?.('.react-flow__node')?.getAttribute('data-id') ?? undefined;
      addActionStep(step, { jobId, position: screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
      return;
    }
    // External drop: a link/card dragged from the browser (e.g. a GitHub Marketplace action).
    // Chrome provides text/uri-list or text/plain; Firefox provides text/x-moz-url
    // ("URL\nTITLE" — first line is the URL).
    const moz = e.dataTransfer.getData('text/x-moz-url');
    const uri = e.dataTransfer.getData('text/uri-list') || moz || e.dataTransfer.getData('text/plain');
    const url = uri
      ? uri.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
      : undefined;
    if (url && /^https?:\/\//i.test(url)) {
      e.preventDefault();
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNotice('Resolving dropped link…', 'info');
      void resolveDroppedUrl(url).then((r) => {
        if (!r) { setNotice(`Couldn't resolve ${url} — no action or workflow found.`, 'error'); return; }
        if (r.kind === 'workflow') addNode(makeReusableWorkflowNode(r.ref), position);
        else addActionStep(makeActionStepFromRef(r.ref), { position });
        addSaved({ name: r.name || r.ref, ref: r.ref, kind: r.kind });
        setNotice(`Added ${r.name || r.ref}`, 'info');
      });
      return;
    }
  }, [addNode, addActionStep, addSaved, setNotice, screenToFlowPosition]);

  const onSelectionChange = useCallback(({ nodes: sel }: OnSelectionChangeParams) => {
    setSelected(sel.length === 1 ? sel[0].id : null);
  }, [setSelected]);

  useEffect(() => {
    if (layoutStamp === 0) return;
    requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 200 });
    });
  }, [layoutStamp, fitView]);

  useEffect(() => {
    requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 200 });
    });
  }, [runOpen, fitView]);

  return (
    <div className="canvas-wrap">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onSelectionChange={onSelectionChange}
        deleteKeyCode={['Backspace', 'Delete']}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
