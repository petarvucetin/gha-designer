import type { GraphSnapshot, Problem } from './types';
import { isRunsOnEmpty } from './mapping';
import { eventSpec } from './catalog';
import type { CallContext } from './localUses';
import { FILE_NAME_RE, parseLocalUses } from './localUses';

interface EdgeLike { source: string; target: string }

export function wouldCreateCycle(edges: EdgeLike[], newEdge: EdgeLike): boolean {
  if (newEdge.source === newEdge.target) return true;
  // DFS from newEdge.target through existing edges; cycle if we reach newEdge.source.
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const queue = [newEdge.target];
  const seen = new Set<string>();
  while (queue.length) {
    const cur = queue.pop()!;
    if (cur === newEdge.source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    queue.push(...(adj.get(cur) ?? []));
  }
  return false;
}

export function validate(snapshot: GraphSnapshot, context?: CallContext): Problem[] {
  const problems: Problem[] = [];
  const { nodes, edges } = snapshot;

  const seenJobIds = new Map<string, string>();
  const seenTriggerTypes = new Set<string>();
  let triggerCount = 0;
  let jobCount = 0;
  for (const n of nodes) {
    if (n.data.kind === 'trigger') {
      triggerCount += 1;
      const t = n.data;
      if (t.trigger === 'schedule' && !t.cron) {
        problems.push({ severity: 'error', nodeId: n.id, message: 'Schedule trigger has no cron expression.' });
      }
      if (t.trigger !== 'schedule') {
        if (seenTriggerTypes.has(t.trigger)) {
          problems.push({
            severity: 'error',
            nodeId: n.id,
            message: `Duplicate trigger "${t.trigger}" — only one ${t.trigger} trigger is allowed.`,
          });
        } else {
          seenTriggerTypes.add(t.trigger);
        }
      }
      if (!eventSpec(t.trigger)) {
        problems.push({ severity: 'warning', nodeId: n.id, message: `Unknown event "${t.trigger}" — it will be exported as-is.` });
      }
      if (t.trigger === 'schedule' && t.cron && t.cron.trim().split(/\s+/).length !== 5) {
        problems.push({ severity: 'warning', nodeId: n.id, message: `Cron "${t.cron}" should have 5 fields.` });
      }
      for (const [label, list] of [
        ['input', t.inputs], ['output', t.outputs], ['secret', t.secretsDecl],
      ] as const) {
        const seen = new Set<string>();
        for (const item of list ?? []) {
          if (!item.id.trim()) {
            problems.push({ severity: 'error', nodeId: n.id, message: `${t.trigger} has a ${label} with an empty id.` });
          } else if (seen.has(item.id)) {
            problems.push({ severity: 'error', nodeId: n.id, message: `Duplicate ${label} id "${item.id}" on ${t.trigger}.` });
          }
          seen.add(item.id);
        }
      }
      for (const i of t.inputs ?? []) {
        if (i.type === 'choice' && !i.options?.length) {
          problems.push({ severity: 'error', nodeId: n.id, message: `Input "${i.id}" is type choice but has no options.` });
        }
      }
      if (t.trigger === 'workflow_call') {
        for (const i of t.inputs ?? []) {
          if (i.type === undefined || i.type === 'choice' || i.type === 'environment') {
            problems.push({
              severity: 'error', nodeId: n.id,
              message: `workflow_call input "${i.id}" must have type string, number, or boolean.`,
            });
          }
        }
      }
      continue;
    }
    jobCount += 1;
    const j = n.data;
    if (seenJobIds.has(j.jobId)) {
      problems.push({ severity: 'error', nodeId: n.id, message: `Duplicate job id "${j.jobId}".` });
    } else {
      seenJobIds.set(j.jobId, n.id);
    }
    if (!j.jobId.trim()) {
      problems.push({ severity: 'error', nodeId: n.id, message: 'Job id is empty.' });
    }
    if (!j.uses) {
      if (isRunsOnEmpty(j.runsOn)) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Job "${j.jobId}" is missing runs-on.` });
      }
      if (j.steps.length === 0) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Job "${j.jobId}" has no steps.` });
      }
      j.steps.forEach((s, i) => {
        const label = s.name || `#${i + 1}`;
        if (s.uses && s.run) {
          problems.push({ severity: 'error', nodeId: n.id, message: `Step ${label} in "${j.jobId}" has both uses and run.` });
        } else if (!s.uses && !s.run) {
          problems.push({ severity: 'error', nodeId: n.id, message: `Step ${label} in "${j.jobId}" has neither uses nor run.` });
        }
      });
    } else {
      if (j.steps.length) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Reusable-workflow job "${j.jobId}" cannot have steps.` });
      }
      if (!isRunsOnEmpty(j.runsOn)) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Reusable-workflow job "${j.jobId}" cannot have runs-on.` });
      }
      if (j.container) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Reusable-workflow job "${j.jobId}" cannot have a container.` });
      }
    }
    if (j.container && !j.container.image.trim()) {
      problems.push({ severity: 'error', nodeId: n.id, message: `Job "${j.jobId}" container has no image.` });
    }
    for (const [sname, svc] of Object.entries(j.services ?? {})) {
      if (!svc.image.trim()) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Service "${sname}" in "${j.jobId}" has no image.` });
      }
    }
    for (const [vname, vals] of Object.entries(j.strategy?.matrix?.vars ?? {})) {
      if (!vname.trim() || vals.length === 0) {
        problems.push({ severity: 'error', nodeId: n.id, message: `Matrix variable "${vname}" in "${j.jobId}" needs a name and at least one value.` });
      }
    }
    if (j.concurrency && !j.concurrency.group.trim()) {
      problems.push({ severity: 'error', nodeId: n.id, message: `Concurrency group in "${j.jobId}" is empty.` });
    }
  }

  // Needs-cycle detection over job→job edges (DFS, three-color).
  const jobIds = new Set(nodes.filter((n) => n.data.kind === 'job').map((n) => n.id));
  const jobEdges = edges.filter((e) => jobIds.has(e.source) && jobIds.has(e.target));
  const adj = new Map<string, string[]>();
  for (const e of jobEdges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const color = new Map<string, 1 | 2>(); // 1=visiting, 2=done
  let cycle = false;
  const visit = (id: string) => {
    if (cycle || color.get(id) === 2) return;
    if (color.get(id) === 1) { cycle = true; return; }
    color.set(id, 1);
    for (const next of adj.get(id) ?? []) visit(next);
    color.set(id, 2);
  };
  for (const id of jobIds) visit(id);
  if (cycle) {
    problems.push({ severity: 'error', message: 'Job dependencies contain a cycle.' });
  }

  if (jobCount > 0 && triggerCount === 0) {
    problems.push({ severity: 'warning', message: 'Workflow has no triggers — GitHub will reject an empty on: block.' });
  }

  if (snapshot.meta.concurrency && !snapshot.meta.concurrency.group.trim()) {
    problems.push({ severity: 'error', message: 'Workflow concurrency group is empty.' });
  }

  if (context) {
    if (!FILE_NAME_RE.test(context.fileName)) {
      problems.push({
        severity: 'error',
        message: `File name "${context.fileName}" is invalid — use letters, digits, . _ - and end with .yml or .yaml.`,
      });
    }

    const seenFiles = new Set<string>();
    for (const f of context.fileNames) {
      if (seenFiles.has(f)) {
        problems.push({ severity: 'error', message: `Duplicate file name "${f}" across tabs.` });
      }
      seenFiles.add(f);
    }

    const seenEff = new Set<string>();
    const dupEff = new Set<string>();
    for (const eff of context.effectiveNames ?? []) {
      if (seenEff.has(eff)) dupEff.add(eff);
      seenEff.add(eff);
    }
    for (const eff of dupEff) {
      problems.push({
        severity: 'warning',
        message: `Two open tabs resolve to the same workflow file "${eff}" — GitHub would treat them as one.`,
      });
    }

    // First-wins: matches the UI, which resolves a fileName to the first tab
    // that has it (see JobForm's picker / TabStrip order).
    const targetByFile = new Map<string, (typeof context.targets)[number]>();
    for (const t of context.targets) {
      if (!targetByFile.has(t.fileName)) targetByFile.set(t.fileName, t);
    }

    for (const n of nodes) {
      if (n.data.kind !== 'job' || typeof n.data.uses !== 'string') continue;
      const j = n.data;
      const parsed = parseLocalUses(j.uses as string);
      if (parsed.kind === 'remote') continue;
      if (parsed.kind === 'invalid-local') {
        const msg = parsed.reason === 'ref'
          ? `Job "${j.jobId}": same-repo workflow calls cannot carry an @ref.`
          : parsed.reason === 'subdir'
            ? `Job "${j.jobId}": reusable workflows must live directly in .github/workflows (no subdirectories).`
            : `Job "${j.jobId}": "${j.uses}" is not a valid local workflow path.`;
        problems.push({ severity: 'error', nodeId: n.id, message: msg });
        continue;
      }
      const target = targetByFile.get(parsed.fileName);
      if (!target) {
        problems.push({
          severity: 'warning', nodeId: n.id,
          message: `Job "${j.jobId}" references local workflow "${parsed.fileName}" which is not open in any tab.`,
        });
        continue;
      }
      if (!target.hasWorkflowCall) {
        problems.push({
          severity: 'error', nodeId: n.id,
          message: `"${parsed.fileName}" has no workflow_call trigger — it cannot be called as a reusable workflow.`,
        });
        continue;
      }
      const withMap = j.with ?? {};
      for (const input of target.inputs) {
        if (input.required && !(input.id in withMap)) {
          problems.push({
            severity: 'error', nodeId: n.id,
            message: `Job "${j.jobId}" is missing required input "${input.id}" of "${parsed.fileName}".`,
          });
        }
      }
      const declared = new Set(target.inputs.map((i) => i.id));
      for (const [key, value] of Object.entries(withMap)) {
        if (!declared.has(key)) {
          problems.push({
            severity: 'error', nodeId: n.id,
            message: `Input "${key}" is not defined in "${parsed.fileName}" — GitHub rejects undeclared inputs.`,
          });
          continue;
        }
        if (typeof value === 'string' && value.includes('${{')) continue;
        const type = target.inputs.find((i) => i.id === key)?.type;
        const actual = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string';
        const expected = type === 'boolean' || type === 'number' ? type : type ? 'string' : undefined;
        if (expected && actual !== expected) {
          problems.push({
            severity: 'error', nodeId: n.id,
            message: `Input "${key}" of "${parsed.fileName}" expects ${expected} but got ${actual}.`,
          });
        }
      }
      if (j.secrets !== 'inherit') {
        const provided = j.secrets ?? {};
        for (const s of target.secrets) {
          if (s.required && !(s.id in provided)) {
            problems.push({
              severity: 'error', nodeId: n.id,
              message: `Job "${j.jobId}" is missing required secret "${s.id}" of "${parsed.fileName}".`,
            });
          }
        }
        const declaredSecrets = new Set(target.secrets.map((s) => s.id));
        for (const key of Object.keys(provided)) {
          if (!declaredSecrets.has(key)) {
            problems.push({
              severity: 'error', nodeId: n.id,
              message: `Secret "${key}" is not defined in "${parsed.fileName}" — GitHub rejects undeclared secrets.`,
            });
          }
        }
      }
    }

    // Cycle detection runs independently of the depth-limited walk below, over
    // ALL open tabs (not just those reachable from the active file within the
    // nesting cutoff) — otherwise a cycle longer than the cutoff would be
    // silently swallowed by the nesting warning before the walk ever loops
    // back on itself. Standard gray/black DFS: a cycle is any edge back to a
    // node still "in progress" (gray).
    const color = new Map<string, 1 | 2>(); // 1 = visiting (gray), 2 = done (black)
    const visitForCycles = (file: string, path: string[]): void => {
      if (color.get(file) === 2) return;
      if (color.get(file) === 1) {
        problems.push({
          severity: 'error',
          message: `Local workflow calls form a cycle: ${[...path.slice(path.indexOf(file)), file].join(' → ')}.`,
        });
        return;
      }
      color.set(file, 1);
      for (const next of context.calls[file] ?? []) visitForCycles(next, [...path, file]);
      color.set(file, 2);
    };
    for (const file of context.fileNames) {
      if (!color.has(file)) visitForCycles(file, []);
    }

    // Depth-limited walk from the active workflow: nesting and unique-workflow
    // count warnings only (cycles are handled above, so this walk can simply
    // stop — not error — when it re-enters a node already on its own path).
    const reached = new Set<string>();
    const walk = (file: string, path: string[]): void => {
      reached.add(file);
      if (path.includes(file)) return;
      const depth = path.length + 1; // levels including this workflow
      if (depth > 10) {
        problems.push({
          severity: 'warning',
          message: `Local workflow calls nest ${depth} levels deep — GitHub allows at most 10.`,
        });
        return;
      }
      for (const next of context.calls[file] ?? []) walk(next, [...path, file]);
    };
    walk(context.fileName, []);
    const calledCount = reached.size - 1; // exclude the root caller itself — GitHub's limit is on *called* workflows
    if (calledCount > 50) {
      problems.push({
        severity: 'warning',
        message: `Local workflow calls reference ${calledCount} unique workflows — GitHub allows at most 50 per run.`,
      });
    }
    // de-duplicate identical graph problems (same cycle reachable via several paths)
    const seenMsg = new Set<string>();
    for (let i = problems.length - 1; i >= 0; i--) {
      if (!/cycle|nest/.test(problems[i].message)) continue;
      if (seenMsg.has(problems[i].message)) problems.splice(i, 1);
      else seenMsg.add(problems[i].message);
    }
  }

  return problems;
}
