import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CopyButton } from '../components';
import { EngramLogo } from '../logo';

const MCP_JSON = `{
  "mcpServers": {
    "engram": { "command": "engram", "args": ["serve"] }
  }
}`;

const IMPORT_PROMPT = `List everything you know or remember about me from our conversations and your
memory. Output it as a plain list I can import into a personal memory vault.

Rules for the output — follow them exactly:

- One fact per line, starting with "- ". No headings, no sections, no
  numbering, no commentary before or after the list.
- Each fact must be atomic (one statement) and phrased in third person so it
  makes sense with zero context: "Michael prefers TypeScript for new
  projects", not "you like TS" or "prefers it".
- Write facts, not summaries of conversations: preferences, ongoing projects
  and their goals, tools and stack, people and pets, constraints, decisions,
  recurring habits.
- If a fact is tied to a specific project, name the project in the sentence:
  "In the polybot project, Michael uses paper trading only."
- Convert relative time to absolute: "as of July 2026", not "recently".
- Only include things you actually know about me. Do not guess, pad, or
  infer personality traits. If you know fewer than 5 things, output fewer.
- Never include passwords, API keys, tokens, or anything secret-shaped, even
  if I told you one.`;

const SETUP = [
  {
    id: 'claude-mcp',
    label: 'Claude Code — MCP tools',
    code: 'claude mcp add engram -- engram serve',
    copy: 'claude mcp add engram -- engram serve',
  },
  {
    id: 'claude-hook',
    label: 'Claude Code — inject at session start',
    code: 'engram install claude-code',
    copy: 'engram install claude-code',
  },
  {
    id: 'mcp-json',
    label: 'Cursor / Claude Desktop',
    code: MCP_JSON,
    copy: MCP_JSON,
  },
  {
    id: 'import',
    label: 'Import siloed memory',
    code: 'engram import chatgpt <export.zip>\nengram import claude',
    copy: 'engram import claude',
    extraCopy: { label: 'ChatGPT import', text: 'engram import chatgpt <export.zip>' },
  },
] as const;

function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    if (reduce || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

function Reveal({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [ref, seen] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={style}
      className={`lp-reveal${seen ? ' lp-reveal-in' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}

/** Animated system diagram: tools → vault files → review → profile → back. */
function SystemDiagram({ id = 'main' }: { id?: string }) {
  const grad = `lp-vault-fill-${id}`;
  const arrow = `lp-arrow-${id}`;

  // Shared path data so packets stay on the arrow strokes
  const paths = {
    toolA: 'M148 148 H214',
    toolB: 'M148 220 H214',
    toolC: 'M148 292 H214',
    toReview: 'M426 160 H486',
    toProfile: 'M426 274 H486',
    returnLoop: 'M552 300 C552 358 320 372 320 336',
  } as const;

  return (
    <svg className="lp-system" viewBox="0 0 640 420" role="img" aria-label="AI tools write to a local vault, you review, pinned facts return to every session">
      <defs>
        <marker id={arrow} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" className="lp-sys-marker" />
        </marker>
        <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7f8f9" />
          <stop offset="100%" stopColor="#e4e8ee" />
        </linearGradient>
      </defs>

      <g className="lp-sys-vault">
        <rect x="220" y="100" width="200" height="232" rx="4" className="lp-sys-vault-body" fill={`url(#${grad})`} />
        <rect x="232" y="120" width="176" height="28" rx="2" className="lp-sys-file lp-sys-file-1" />
        <rect x="232" y="160" width="176" height="28" rx="2" className="lp-sys-file lp-sys-file-2" />
        <rect x="232" y="200" width="176" height="28" rx="2" className="lp-sys-file lp-sys-file-3" />
        <rect x="232" y="240" width="176" height="28" rx="2" className="lp-sys-file lp-sys-file-4" />
        <text x="320" y="310" textAnchor="middle" className="lp-sys-label">
          ~/.engram
        </text>
      </g>

      <g className="lp-sys-tool lp-sys-tool-a">
        <rect x="28" y="126" width="120" height="44" rx="3" className="lp-sys-box" />
        <text x="88" y="153" textAnchor="middle" className="lp-sys-label">
          Claude Code
        </text>
      </g>
      <g className="lp-sys-tool lp-sys-tool-b">
        <rect x="28" y="198" width="120" height="44" rx="3" className="lp-sys-box" />
        <text x="88" y="225" textAnchor="middle" className="lp-sys-label">
          Cursor
        </text>
      </g>
      <g className="lp-sys-tool lp-sys-tool-c">
        <rect x="28" y="270" width="120" height="44" rx="3" className="lp-sys-box" />
        <text x="88" y="297" textAnchor="middle" className="lp-sys-label">
          Desktop
        </text>
      </g>

      <g className="lp-sys-side lp-sys-inbox">
        <rect x="492" y="125" width="120" height="70" rx="3" className="lp-sys-box" />
        <text x="552" y="157" textAnchor="middle" className="lp-sys-label">
          Review
        </text>
        <text x="552" y="177" textAnchor="middle" className="lp-sys-sub">
          you decide
        </text>
      </g>
      <g className="lp-sys-side lp-sys-profile">
        <rect x="492" y="239" width="120" height="70" rx="3" className="lp-sys-box lp-sys-box-accent" />
        <text x="552" y="271" textAnchor="middle" className="lp-sys-label">
          Profile
        </text>
        <text x="552" y="291" textAnchor="middle" className="lp-sys-sub">
          pinned facts
        </text>
      </g>

      <path className="lp-sys-path" d={paths.toolA} markerEnd={`url(#${arrow})`} />
      <path className="lp-sys-path" d={paths.toolB} markerEnd={`url(#${arrow})`} />
      <path className="lp-sys-path" d={paths.toolC} markerEnd={`url(#${arrow})`} />
      <path className="lp-sys-path" d={paths.toReview} markerEnd={`url(#${arrow})`} />
      <path className="lp-sys-path" d={paths.toProfile} markerEnd={`url(#${arrow})`} />
      <path className="lp-sys-path lp-sys-path-return" d={paths.returnLoop} markerEnd={`url(#${arrow})`} />

      <circle className="lp-sys-packet" r="3.5">
        <animateMotion dur="2.6s" repeatCount="indefinite" rotate="auto" path={paths.toolA} />
      </circle>
      <circle className="lp-sys-packet" r="3.5">
        <animateMotion dur="3s" begin="0.55s" repeatCount="indefinite" rotate="auto" path={paths.toolB} />
      </circle>
      <circle className="lp-sys-packet" r="3.5">
        <animateMotion dur="3.4s" begin="1.1s" repeatCount="indefinite" rotate="auto" path={paths.toolC} />
      </circle>
      <circle className="lp-sys-packet" r="3.5">
        <animateMotion dur="2.8s" begin="0.8s" repeatCount="indefinite" rotate="auto" path={paths.toReview} />
      </circle>
      <circle className="lp-sys-packet lp-sys-packet-return" r="3.5">
        <animateMotion dur="4.5s" begin="0.3s" repeatCount="indefinite" rotate="auto" path={paths.returnLoop} />
      </circle>
    </svg>
  );
}

/** Hero focal: tools → vault, one clear scene. */
function HeroStage() {
  const tools = ['Claude Code', 'Cursor', 'Desktop'] as const;
  const files = [
    '20260713-prefers-typescript.md',
    '20260712-deploy-friday.md',
    '20260711-standup-time.md',
  ] as const;
  const [active, setActive] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    if (reduce) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % files.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [files.length]);

  const paths = [
    'M60 4 C60 36 180 44 180 92',
    'M180 4 C180 28 180 56 180 92',
    'M300 4 C300 36 180 44 180 92',
  ] as const;

  return (
    <div className="lp-showcase" aria-hidden="true">
      <div className="lp-showcase-tools">
        {tools.map((tool, i) => (
          <span key={tool} className="lp-tool-chip" style={{ '--i': i } as CSSProperties}>
            {tool}
            <i className="lp-tool-port" />
          </span>
        ))}
      </div>

      <div className="lp-flow">
        <svg className="lp-flow-svg" viewBox="0 0 360 96" preserveAspectRatio="none">
          {paths.map((d, i) => (
            <g key={d}>
              <path className="lp-flow-line" d={d} />
              <circle className={`lp-flow-packet lp-flow-packet-${i}`} r="3.5">
                <animateMotion dur="2.4s" begin={`${i * 0.55}s`} repeatCount="indefinite" path={d} />
              </circle>
            </g>
          ))}
          <circle className="lp-flow-sink" cx="180" cy="92" r="4.5" />
        </svg>
      </div>

      <div className="lp-showcase-scene">
        <div className="lp-showcase-vault">
          <div className="lp-vault-head">
            <span className="lp-vault-icon" aria-hidden="true">
              ◉
            </span>
            <span>~/.engram/memories/</span>
          </div>
          <ul className="lp-vault-files">
            {files.map((name, i) => (
              <li
                key={name}
                className={`lp-vault-file${i === active ? ' lp-vault-file-active' : ''}`}
                style={{ '--i': i } as CSSProperties}
              >
                <span className="lp-vault-file-icon" aria-hidden="true">
                  ▤
                </span>
                {name}
              </li>
            ))}
          </ul>
          <div className="lp-vault-foot">
            <span className="lp-vault-pill lp-vault-pill-warn">review inbox</span>
            <span className="lp-vault-pill lp-vault-pill-ok">★ profile</span>
          </div>
        </div>
      </div>

      <p className="lp-showcase-caption">written by any tool · stored as markdown · loaded every session</p>
    </div>
  );
}

function CapabilityArt({ kind }: { kind: 'files' | 'mcp' | 'scope' | 'conflict' | 'audit' | 'local' }) {
  if (kind === 'files') {
    return (
      <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
        <rect className="lp-cap-stroke" x="18" y="14" width="52" height="54" rx="2" />
        <rect className="lp-cap-fill" x="28" y="10" width="52" height="54" rx="2" />
        <rect className="lp-cap-fill-strong" x="38" y="6" width="52" height="54" rx="2" />
        <path className="lp-cap-ink" d="M48 22h32M48 32h28M48 42h24" />
      </svg>
    );
  }
  if (kind === 'mcp') {
    return (
      <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
        <circle className="lp-cap-fill-strong" cx="60" cy="40" r="14" />
        <circle className="lp-cap-stroke" cx="24" cy="22" r="8" />
        <circle className="lp-cap-stroke" cx="96" cy="22" r="8" />
        <circle className="lp-cap-stroke" cx="24" cy="58" r="8" />
        <circle className="lp-cap-stroke" cx="96" cy="58" r="8" />
        <path className="lp-cap-ink" d="M32 26L48 34M88 26L72 34M32 54L48 46M88 54L72 46" />
      </svg>
    );
  }
  if (kind === 'scope') {
    return (
      <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
        <rect className="lp-cap-stroke" x="16" y="18" width="40" height="44" rx="2" />
        <rect className="lp-cap-fill-strong" x="64" y="18" width="40" height="44" rx="2" />
        <text x="36" y="44" textAnchor="middle" className="lp-cap-mini">
          A
        </text>
        <text x="84" y="44" textAnchor="middle" className="lp-cap-mini">
          B
        </text>
      </svg>
    );
  }
  if (kind === 'conflict') {
    return (
      <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
        <rect className="lp-cap-stroke" x="14" y="22" width="42" height="36" rx="2" />
        <rect className="lp-cap-stroke" x="64" y="22" width="42" height="36" rx="2" />
        <path className="lp-cap-warn" d="M56 28 L64 40 L56 52" fill="none" />
        <path className="lp-cap-ink" d="M24 36h22M24 46h16M74 36h22M74 46h16" />
      </svg>
    );
  }
  if (kind === 'audit') {
    return (
      <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
        <rect className="lp-cap-fill" x="28" y="16" width="64" height="48" rx="3" />
        <path className="lp-cap-ok" d="M48 40 l10 10 18-22" fill="none" strokeWidth="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 80" className="lp-cap-art" aria-hidden="true">
      <circle className="lp-cap-stroke" cx="60" cy="40" r="26" />
      <circle className="lp-cap-fill-strong" cx="60" cy="40" r="8" />
      <path className="lp-cap-ink" d="M60 14v10M60 56v10M14 40h10M96 40h10" />
    </svg>
  );
}

const CAPS = [
  {
    kind: 'files' as const,
    title: 'Plain markdown files',
    body: 'Every memory lives in ~/.engram/memories — grep it, edit in vim, sync with git or Obsidian.',
  },
  {
    kind: 'mcp' as const,
    title: 'Every MCP client',
    body: 'One server, five tools — remember, recall, confirm, update, forget — plus engram://profile.',
  },
  {
    kind: 'scope' as const,
    title: 'Project scopes',
    body: 'Scoped recall returns this project’s facts plus global ones — never another project’s.',
  },
  {
    kind: 'conflict' as const,
    title: 'Contradiction alarms',
    body: 'Overlapping facts are flagged to the agent at write time and to you in the review inbox.',
  },
  {
    kind: 'audit' as const,
    title: 'You audit everything',
    body: 'Agent writes land unreviewed and attributed. Approve, edit, or reject.',
  },
  {
    kind: 'local' as const,
    title: 'Local first',
    body: 'No cloud, no account, no telemetry. Binds to 127.0.0.1 unless you say otherwise.',
  },
];

const PRINCIPLES = [
  {
    title: 'Files over databases',
    body: 'Your memory should outlive this tool and your AI subscriptions.',
    art: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path className="lp-stance-icon" d="M12 8h18l8 8v24H12z" fill="none" />
        <path className="lp-stance-icon" d="M30 8v8h8" fill="none" />
      </svg>
    ),
  },
  {
    title: 'Audit over gatekeeping',
    body: 'Agents write immediately; everything is attributed. Trust, then verify.',
    art: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="lp-stance-icon" cx="24" cy="24" r="14" fill="none" />
        <path className="lp-stance-icon" d="M18 24l5 5 9-11" fill="none" />
      </svg>
    ),
  },
  {
    title: 'Data, not instructions',
    body: 'Recalled context is framed as stored data — never a prompt-injection channel.',
    art: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect className="lp-stance-icon" x="10" y="12" width="28" height="24" rx="2" fill="none" />
        <path className="lp-stance-icon" d="M16 20h16M16 26h12" fill="none" />
      </svg>
    ),
  },
  {
    title: 'No lock-in',
    body: 'Leaving Engram is cp -r ~/.engram/memories . — as it should be.',
    art: (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path className="lp-stance-icon" d="M14 24h20M26 16l8 8-8 8" fill="none" />
      </svg>
    ),
  },
] as const;

export function Landing() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={`lp${ready ? ' lp-ready' : ''}`}>
      <div className="lp-grain" aria-hidden="true" />

      <header className="lp-bar">
        <a className="lp-brand" href="#/">
          <EngramLogo className="lp-brand-lockup" markClassName="lp-brand-mark" textClassName="lp-brand-text" />
        </a>
        <nav className="lp-bar-nav" aria-label="Site">
          <a className="lp-nav-link lp-nav-active" href="#/" aria-current="page">
            Home
          </a>
          <a className="lp-nav-link" href="#/help">
            Help
          </a>
          <a className="lp-enter" href="#/vault">
            Open vault
          </a>
        </nav>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <h1 className="lp-name">engram</h1>
          <p className="lp-line">One memory. Every AI. Yours.</p>
          <p className="lp-lead">
            Every AI either forgets you every session or silos what it learns. Engram is the portable memory layer —
            local markdown files any tool plugs into over MCP.
          </p>
          <div className="lp-cta">
            <a className="lp-cta-main" href="#/vault">
              Open your vault
            </a>
            <a className="lp-cta-sub" href="#how">
              See how it moves →
            </a>
          </div>
        </div>
        <div className="lp-hero-visual">
          <HeroStage />
        </div>
      </section>

      <section className="lp-block lp-block-wide" id="how">
        <Reveal>
          <h2 className="lp-h">The loop</h2>
          <p className="lp-sub">Watch a fact travel — written by an AI, stored as a file, reviewed by you, loaded next session.</p>
        </Reveal>

        <Reveal className="lp-stage-panel">
          <SystemDiagram id="loop" />
        </Reveal>

        <Reveal className="lp-chat">
          <div className="lp-bubble lp-bubble-you">
            <span>you</span>
            <p>remember that our staging deploys go out Friday mornings</p>
          </div>
          <div className="lp-bubble lp-bubble-later">
            <span>later · different tool</span>
            <p>when do we deploy to staging?</p>
          </div>
          <div className="lp-bubble lp-bubble-ai">
            <span>it</span>
            <p>
              recalls → <em>Friday mornings</em>
            </p>
          </div>
        </Reveal>
      </section>

      <section className="lp-block lp-block-wide" id="why">
        <Reveal>
          <h2 className="lp-h">What it is</h2>
          <p className="lp-sub">Six things Engram does that siloed chat memory cannot.</p>
        </Reveal>
        <div className="lp-caps">
          {CAPS.map((cap, i) => (
            <Reveal key={cap.title} className="lp-cap" style={{ '--i': i } as CSSProperties}>
              <CapabilityArt kind={cap.kind} />
              <h3>{cap.title}</h3>
              <p>{cap.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-block" id="setup">
        <Reveal>
          <h2 className="lp-h">Connect a tool</h2>
          <p className="lp-sub">Copy, paste, stay on loopback.</p>
        </Reveal>

        <Reveal className="lp-recipe lp-recipe-prompt">
          <div className="lp-recipe-head">
            <span>Seed from chat memory</span>
            <CopyButton text={IMPORT_PROMPT} label="Copy prompt" variant="landing" />
          </div>
          <p className="lp-prompt-note">
            Paste into ChatGPT, Claude, Gemini, or any AI that already knows you. Save the bullet list, then import
            with <code>engram import</code> or add memories in the vault.
          </p>
          <details className="lp-prompt-details">
            <summary>Show prompt</summary>
            <pre>{IMPORT_PROMPT}</pre>
          </details>
        </Reveal>

        <div className="lp-recipes">
          {SETUP.map((item) => (
            <Reveal key={item.id} className="lp-recipe">
              <div className="lp-recipe-head">
                <span>{item.label}</span>
                <div className="lp-recipe-copies">
                  {'extraCopy' in item && item.extraCopy && (
                    <CopyButton text={item.extraCopy.text} label={item.extraCopy.label} variant="landing" />
                  )}
                  <CopyButton
                    text={item.copy}
                    label={item.id === 'import' ? 'Claude import' : 'Copy'}
                    variant="landing"
                  />
                </div>
              </div>
              <pre>{item.code}</pre>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lp-block" id="stances">
        <Reveal>
          <h2 className="lp-h">Stances</h2>
        </Reveal>
        <div className="lp-stance-grid">
          {PRINCIPLES.map((p) => (
            <Reveal key={p.title} className="lp-stance">
              <div className="lp-stance-art">{p.art}</div>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <footer className="lp-end">
        <Reveal>
          <div className="lp-end-brand">
            <EngramLogo
              className="lp-end-brand-lockup"
              markClassName="lp-end-brand-mark"
              textClassName="lp-end-brand-text"
            />
          </div>
          <a className="lp-cta-main" href="#/vault">
            Open your vault
          </a>
          <p className="lp-end-note">127.0.0.1 · no cloud · no telemetry</p>
        </Reveal>
      </footer>
    </div>
  );
}
