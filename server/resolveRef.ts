export type ResolvedRef = { kind: 'action' | 'workflow'; ref: string; name?: string };

export type ParseResult =
  | { done: ResolvedRef }
  | { fetchMarketplace: string } // absolute github.com marketplace URL to fetch
  | null;                        // not a github.com URL we handle

const WF_RE = /\.github\/workflows\/[^/\\]+\.ya?ml$/;

// First path segments that are GitHub product/site routes, not repo owners — e.g.
// github.com/settings/profile or github.com/features/actions. Without this guard those
// 2-segment paths fall into the plain-repo branch below and mint an action ref that can
// never run (owner "settings" or "features" doesn't exist). Also used by extractSourceRepo
// to ignore the same non-repo routes when scanning a marketplace page's raw href links for
// the action's dominant source-repo mention.
const RESERVED_OWNERS = new Set([
  'marketplace', 'settings', 'features', 'sponsors', 'orgs', 'apps', 'topics', 'collections',
  'about', 'pricing', 'enterprise', 'security', 'notifications', 'explore', 'new', 'login', 'join',
  'contact', 'site', 'customer-stories', 'readme', 'account', 'organizations', 'users', 'codespaces', 'dashboard',
  'resources', 'solutions', 'team', 'premium-support', 'pulls', 'issues', 'watching', 'stars',
]);

/**
 * Parse a dropped GitHub URL WITHOUT fetching.
 * Only https://github.com URLs are handled (SSRF guard: anything else → null).
 * - github.com/marketplace/actions/<slug>       → { fetchMarketplace: <url> }  (needs page fetch for uses:)
 * - github.com/<o>/<r>/(blob|tree)/<ref>/<path…>.github/workflows/<f>.yml
 *        OR any github.com/<o>/<r>/…/.github/workflows/<f>.yml with a ref segment
 *                                               → { done: workflow ref 'o/r/.github/workflows/f.yml@ref' }
 * - github.com/<o>/<r>                          → { done: action ref 'o/r', name: r }
 * - anything else                               → null
 */
export function parseGithubUrl(raw: string): ParseResult {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null;
  const segs = u.pathname.split('/').filter(Boolean);
  // marketplace: terminal branch. Only o/r-shaped marketplace/actions/<slug> resolves;
  // anything else under /marketplace (category page, collections, …) is not a repo ref.
  if (segs[0] === 'marketplace') {
    if (segs[1] === 'actions' && segs[2]) {
      return { fetchMarketplace: `https://github.com/marketplace/actions/${segs[2]}` };
    }
    return null;
  }
  // reusable workflow file: /o/r/(blob|tree)/<ref>/....github/workflows/x.yml
  if (segs.length >= 5 && (segs[2] === 'blob' || segs[2] === 'tree')) {
    const [owner, repo, , ref, ...rest] = segs;
    const p = rest.join('/');
    if (WF_RE.test('/' + p)) {
      const idx = p.indexOf('.github/workflows/');
      const file = p.slice(idx);
      return { done: { kind: 'workflow', ref: `${owner}/${repo}/${file}@${ref}`, name: file.split('/').pop() } };
    }
  }
  // plain repo → action ref (no @ref; user/act supplies default)
  if (segs.length === 2 && !RESERVED_OWNERS.has(segs[0].toLowerCase())) {
    return { done: { kind: 'action', ref: `${segs[0]}/${segs[1]}`, name: segs[1] } };
  }
  return null;
}

/**
 * Find the dominant source-repo mention (owner/repo) among a marketplace page's raw
 * `href="/owner/repo…"` links. Some action pages ship no `uses:` install snippet at all;
 * the repo they're generated from is still the most-linked non-reserved 2-segment path on
 * the page (nav links, "View on GitHub", release links, etc. all point at it repeatedly).
 */
export function extractSourceRepo(html: string): string | undefined {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/href="\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)(?:["/?#])/g)) {
    const owner = m[1], repo = m[2];
    if (RESERVED_OWNERS.has(owner.toLowerCase())) continue;
    const key = `${owner}/${repo}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best: string | undefined; let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
}

/** Extract a GitHub repo page's default branch from its raw HTML (embedded JSON blob). */
export function extractDefaultBranch(html: string): string | undefined {
  const m = html.match(/"defaultBranch":"([^"]+)"/);
  return m ? m[1] : undefined;
}

/** Extract the runnable ref + name from a fetched marketplace ACTION page HTML. */
export function extractFromMarketplaceHtml(html: string): { ref?: string; repo?: string; name?: string } {
  // install snippet: `uses: owner/repo@ver`
  const uses = html.match(/uses:\s*([A-Za-z0-9._\-/@]+@[A-Za-z0-9._\-/@]+)/);
  // page <title> "Figma Action · Actions · GitHub Marketplace · GitHub" → "Figma Action"
  const title = html.match(/<title>([^<]*)<\/title>/i);
  const name = title ? title[1].split('·')[0].trim() : undefined;
  const repo = extractSourceRepo(html);
  return { ref: uses ? uses[1] : undefined, repo, name: name || undefined };
}
