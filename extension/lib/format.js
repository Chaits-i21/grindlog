// Shared formatting helpers. Pure ES module — imported by background.js (service
// worker), content.js (dynamic import), and options.js. htmlToMarkdown needs a DOM,
// so it must only be called from content/options contexts, never the service worker.

export const LANG_EXT = {
  java: 'java', python: 'py', python3: 'py', pythondata: 'py',
  c: 'c', cpp: 'cpp', csharp: 'cs',
  javascript: 'js', typescript: 'ts',
  golang: 'go', rust: 'rs', kotlin: 'kt', swift: 'swift',
  ruby: 'rb', scala: 'scala', php: 'php', dart: 'dart',
  racket: 'rkt', erlang: 'erl', elixir: 'ex', bash: 'sh',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql',
};

const HASH_COMMENT = new Set(['python', 'python3', 'pythondata', 'ruby', 'bash', 'elixir']);
const DASH_COMMENT = new Set(['mysql', 'mssql', 'oraclesql', 'postgresql']);

export function commentPrefix(lang) {
  if (HASH_COMMENT.has(lang)) return '#';
  if (DASH_COMMENT.has(lang)) return '--';
  if (lang === 'racket') return ';;';
  if (lang === 'erlang') return '%';
  return '//';
}

export function extFor(lang) {
  return LANG_EXT[lang] || 'txt';
}

// "0001-two-sum"
export function folderName(frontendId, slug) {
  return `${String(frontendId).padStart(4, '0')}-${slug}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  return `${formatDate(ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "2026-07-12_132705_21ms.java"
export function buildFilename(submittedAt, runtime, lang) {
  const d = new Date(submittedAt);
  const stamp = `${formatDate(submittedAt)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rt = runtime ? `_${String(runtime).replace(/\s+/g, '')}` : '';
  return `${stamp}${rt}.${extFor(lang)}`;
}

// Comment header prepended to every solution file.
export function buildSolutionFile(payload) {
  const { code, lang, submittedAt, stats = {}, meta, extra = {} } = payload;
  const c = commentPrefix(lang);
  const lines = [];
  lines.push(`${c} ${meta.frontendId}. ${meta.title}  [${meta.difficulty}]`);
  if (meta.topics && meta.topics.length) lines.push(`${c} Topics: ${meta.topics.join(', ')}`);
  const perf = [];
  if (stats.runtime) perf.push(`Runtime: ${stats.runtime}${stats.runtimeBeats != null ? ` (beats ${stats.runtimeBeats}%)` : ''}`);
  if (stats.memory) perf.push(`Memory: ${stats.memory}${stats.memoryBeats != null ? ` (beats ${stats.memoryBeats}%)` : ''}`);
  if (perf.length) lines.push(`${c} ${perf.join(' | ')}`);
  const solved = [];
  if (extra.minutes != null) solved.push(`Solved in ${extra.minutes} min`);
  if (extra.failedAttempts != null && extra.failedAttempts > 0) {
    solved.push(`after ${extra.failedAttempts} failed attempt${extra.failedAttempts === 1 ? '' : 's'}`);
  }
  if (solved.length) lines.push(`${c} ${solved.join(' ')}`);
  if (extra.dailyDate) lines.push(`${c} Daily Challenge (${extra.dailyDate})`);
  lines.push(`${c} Submitted: ${formatDateTime(submittedAt)}`);
  lines.push(`${c} ${meta.url}`);
  return `${lines.join('\n')}\n\n${code.trim()}\n`;
}

// Per-problem README.md: statement + metadata + table of all approaches.
export function buildProblemReadme(meta, solutions) {
  const out = [];
  out.push(`# ${meta.frontendId}. ${meta.title}`);
  out.push('');
  out.push(`- **Difficulty:** ${meta.difficulty}`);
  if (meta.topics && meta.topics.length) out.push(`- **Topics:** ${meta.topics.join(', ')}`);
  out.push(`- **Link:** ${meta.url}`);
  out.push('');
  out.push('## Problem');
  out.push('');
  out.push(meta.contentMd || '_Statement unavailable._');
  if (meta.hints && meta.hints.length) {
    out.push('');
    out.push('## Hints');
    out.push('');
    meta.hints.forEach((h, i) => {
      out.push(`<details><summary>Hint ${i + 1}</summary>${h}</details>`);
    });
  }
  out.push('');
  out.push('## Solutions');
  out.push('');
  out.push('| File | Language | Runtime | Memory | Submitted |');
  out.push('|------|----------|---------|--------|-----------|');
  for (const s of solutions) {
    const rt = s.runtime ? `${s.runtime}${s.runtimeBeats != null ? ` (${s.runtimeBeats}%)` : ''}` : '—';
    const mem = s.memory ? `${s.memory}${s.memoryBeats != null ? ` (${s.memoryBeats}%)` : ''}` : '—';
    out.push(`| [${s.file}](./${encodeURIComponent(s.file)}) | ${s.lang} | ${rt} | ${mem} | ${formatDateTime(s.submittedAt)} |`);
  }
  out.push('');
  return out.join('\n');
}

// HTML → readable markdown-ish text. DOM contexts only (uses DOMParser).
export function htmlToMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent.replace(/ /g, ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const kids = () => Array.from(node.childNodes).map(walk).join('');
    switch (node.tagName) {
      case 'P': return `${kids().trim()}\n\n`;
      case 'BR': return '\n';
      case 'PRE': return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
      case 'CODE': return `\`${node.textContent}\``;
      case 'STRONG': case 'B': return `**${kids().trim()}**`;
      case 'EM': case 'I': return `*${kids().trim()}*`;
      case 'SUP': return `^${kids()}`;
      case 'SUB': return `_${kids()}`;
      case 'UL': case 'OL': {
        const items = Array.from(node.children)
          .filter((c) => c.tagName === 'LI')
          .map((li, i) => `${node.tagName === 'OL' ? `${i + 1}.` : '-'} ${walk(li).trim()}`);
        return `${items.join('\n')}\n\n`;
      }
      case 'LI': return kids();
      case 'IMG': return node.src ? `![image](${node.src})` : '';
      default: return kids();
    }
  }

  return walk(doc.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
