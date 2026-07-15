import { eventSpec } from '../model/catalog';
import {
  EVENTS_DOCS_URL, eventDocsUrl, eventHelp, topic, topicUrl,
} from '../model/docs';
import type { JobData } from '../model/types';
import { useEditor } from '../store';
import DocsLink from './widgets/DocsLink';

function TopicItem({ k }: { k: string }) {
  const t = topic(k);
  if (!t) return null;
  return (
    <li className="help-topic">
      <div className="help-topic-head">
        <strong>{t.title}</strong> {t.anchor && <DocsLink href={topicUrl(k)} />}
      </div>
      <p>{t.help}</p>
    </li>
  );
}

function jobTopics(j: JobData): string[] {
  if (j.uses !== undefined) {
    const keys = ['uses', 'with', 'secrets', 'needs'];
    if (j.permissions !== undefined) keys.push('permissions');
    if (j.concurrency) keys.push('concurrency');
    if (j.strategy) keys.push('matrix');
    return keys;
  }
  const keys = ['runs-on', 'steps', 'needs'];
  if (j.permissions !== undefined) keys.push('permissions');
  if (j.environment !== undefined) keys.push('environment');
  if (j.concurrency) keys.push('concurrency');
  if (j.outputs) keys.push('outputs');
  if (j.strategy) keys.push('matrix');
  if (j.container) keys.push('container');
  if (j.services) keys.push('services');
  if (j.defaults) keys.push('defaults');
  if (j.continueOnError !== undefined) keys.push('continue-on-error');
  if (j.timeoutMinutes != null) keys.push('timeout-minutes');
  return keys;
}

const WORKFLOW_TOPICS = ['name', 'run-name', 'on', 'permissions', 'env', 'concurrency', 'defaults', 'jobs', 'run'];

export default function HelpPanel() {
  const node = useEditor((s) => s.nodes.find((n) => n.id === s.selectedId));

  if (!node) {
    return (
      <div className="help-panel">
        <div className="section-title">workflow help</div>
        <p className="help-lead">
          Nothing is selected, so these are the workflow-level settings edited in
          the Config tab. Select a node on the canvas for its specific help.
        </p>
        <ul>{WORKFLOW_TOPICS.map((k) => <TopicItem key={k} k={k} />)}</ul>
      </div>
    );
  }

  if (node.data.kind === 'trigger') {
    const t = node.data;
    const spec = eventSpec(t.trigger);
    return (
      <div className="help-panel">
        <div className="section-title">trigger: {t.trigger}</div>
        <p className="help-lead">{eventHelp(t.trigger)}</p>
        {spec?.types && (
          <p>Activity types narrow which {t.trigger} actions fire the workflow — none selected means all.</p>
        )}
        {spec?.filters && (
          <p>Branch/path/tag filters (and their -ignore variants) further narrow when this trigger fires.</p>
        )}
        <p>
          <DocsLink href={spec ? eventDocsUrl(t.trigger) : EVENTS_DOCS_URL}>
            Official documentation: {t.trigger}
          </DocsLink>
        </p>
      </div>
    );
  }

  const j = node.data;
  const reusable = j.uses !== undefined;
  return (
    <div className="help-panel">
      <div className="section-title">job: {j.jobId}</div>
      <p className="help-lead">
        {reusable
          ? 'This job calls a reusable workflow instead of running its own steps. Inputs go through "with", secrets through "secrets", and the called file declares them via workflow_call.'
          : 'This job runs its steps in order on the selected runner. Wire jobs together to express needs: dependencies.'}
      </p>
      <ul>{jobTopics(j).map((k) => <TopicItem key={k} k={k} />)}</ul>
    </div>
  );
}
