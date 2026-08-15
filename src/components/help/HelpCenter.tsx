'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  Info,
  Lightbulb,
  LockKeyhole,
  MessageSquare,
  PanelTop,
  Printer,
  Search,
  ShieldAlert,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  HELP_TABS,
  getHelpSectionText,
  getHelpTab,
  isHelpTabId,
  type HelpAudience,
  type HelpBlock,
  type HelpCalloutTone,
  type HelpSection,
  type HelpTab,
  type HelpTabId,
} from '@/lib/help/content';
import {
  buildHelpJson,
  buildHelpMarkdown,
  getHelpExportFilename,
  type HelpExportFormat,
  type HelpExportScope,
} from '@/lib/help/export';

type UserRole = 'user' | 'superuser' | 'admin' | 'super_admin';

interface SearchResult {
  tab: HelpTab;
  section: HelpSection;
  score: number;
}

const TAB_ICONS: Record<HelpTab['icon'], LucideIcon> = {
  sparkles: Sparkles,
  message: MessageSquare,
  panels: PanelTop,
  bot: Bot,
};

const CALLOUT_CONFIG: Record<
  HelpCalloutTone,
  { icon: LucideIcon; className: string; iconClassName: string }
> = {
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50/80 dark:border-blue-900 dark:bg-blue-950/40',
    iconClassName: 'text-blue-600 dark:text-blue-400',
  },
  tip: {
    icon: Lightbulb,
    className: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/40',
    iconClassName: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    icon: ShieldAlert,
    className: 'border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/40',
    iconClassName: 'text-amber-600 dark:text-amber-400',
  },
  security: {
    icon: LockKeyhole,
    className: 'border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/40',
    iconClassName: 'text-rose-600 dark:text-rose-400',
  },
};

const AUDIENCE_STYLES: Record<HelpAudience, string> = {
  'All roles': 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  User: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  Superuser: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  Admin: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  'Super Admin': 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  Developer: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

function normalizeSearch(value: string): string[] {
  return value
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function rankSection(tab: HelpTab, section: HelpSection, terms: string[]): number {
  const title = section.title.toLowerCase();
  const keywords = section.keywords.join(' ').toLowerCase();
  const body = getHelpSectionText(section).toLowerCase();
  const tabText = `${tab.label} ${tab.description}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (!body.includes(term) && !tabText.includes(term)) return 0;
    if (title === term) score += 100;
    else if (title.includes(term)) score += 35;
    if (keywords.includes(term)) score += 20;
    if (tab.label.toLowerCase().includes(term)) score += 12;
    if (body.includes(term)) score += 4;
  }

  return score;
}

function AudienceBadges({ audiences }: { audiences: HelpAudience[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Option availability and audience">
      {audiences.map((audience) => (
        <span
          key={audience}
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${AUDIENCE_STYLES[audience]}`}
        >
          {audience}
        </span>
      ))}
    </div>
  );
}

function CodeBlock({ block }: { block: Extract<HelpBlock, { type: 'code' }> }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(block.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-200">{block.label}</p>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{block.language}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={`Copy ${block.label}`}
        >
          {copied ? <Check size={15} /> : <Clipboard size={15} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto p-4 text-sm leading-6">
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

function ContentBlock({ block }: { block: HelpBlock }) {
  switch (block.type) {
    case 'paragraph':
      return <p className="text-sm leading-7 text-slate-600 dark:text-slate-300">{block.text}</p>;
    case 'list':
      return (
        <ul className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {block.items.map((item) => (
            <li key={item} className="flex gap-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="space-y-4">
          {block.items.map((item, index) => (
            <li key={`${item.title}-${index}`} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                {index + 1}
              </span>
              <div className="pt-0.5">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
              </div>
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                {block.headers.map((header) => (
                  <th key={header} scope="col" className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="align-top">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-4 py-3 leading-6 text-slate-600 dark:text-slate-300 ${cellIndex === 0 ? 'font-medium text-slate-900 dark:text-slate-100' : ''}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'callout': {
      const config = CALLOUT_CONFIG[block.tone];
      const Icon = config.icon;
      return (
        <aside className={`flex gap-3 rounded-xl border p-4 ${config.className}`}>
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconClassName}`} aria-hidden="true" />
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}</h4>
            <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{block.text}</p>
          </div>
        </aside>
      );
    }
    case 'code':
      return <CodeBlock block={block} />;
    case 'cards':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {block.items.map((item) => (
            <div key={item.title} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h4>
              <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
            </div>
          ))}
        </div>
      );
  }
}

function HelpSectionCard({ section, userRole }: { section: HelpSection; userRole: UserRole }) {
  const canUseAction = section.action?.allowedRoles.includes(
    userRole as 'superuser' | 'admin' | 'super_admin'
  );

  return (
    <section
      id={section.id}
      tabIndex={-1}
      className="help-section scroll-mt-44 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/60 dark:border-slate-800 dark:bg-slate-950 sm:p-7"
      aria-labelledby={`${section.id}-title`}
    >
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-5 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={`${section.id}-title`} className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">
            {section.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{section.summary}</p>
        </div>
        <AudienceBadges audiences={section.audiences} />
      </div>

      <div className="space-y-5">
        {section.blocks.map((block, index) => (
          <ContentBlock key={`${block.type}-${index}`} block={block} />
        ))}
      </div>

      {section.action && (
        <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
          {canUseAction ? (
            <Link
              href={section.action.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950"
            >
              {section.action.label}
              <ExternalLink size={16} aria-hidden="true" />
            </Link>
          ) : (
            <div className="inline-flex max-w-full flex-col gap-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 dark:text-slate-400" aria-disabled="true">
                <LockKeyhole size={16} aria-hidden="true" />
                {section.action.label}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{section.action.requirement}. Contact your administrator.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PrintableTabs({ tabs }: { tabs: HelpTab[] }) {
  return (
    <div className="help-print-only hidden">
      <h1 className="text-3xl font-bold">AI Assistant Help Center</h1>
      <p className="mt-2 text-sm">The same guide content is available to every user role. Availability labels identify role-dependent options.</p>
      {tabs.map((tab) => (
        <article key={tab.id} className="mt-8">
          <h2 className="text-2xl font-bold">{tab.label}</h2>
          <p className="mt-1">{tab.description}</p>
          <div className="mt-5 space-y-6">
            {tab.sections.map((section) => (
              <div key={section.id}>
                <h3 className="text-xl font-bold">{section.title}</h3>
                <p className="mt-1 text-xs font-semibold">Available to / audience: {section.audiences.join(', ')}</p>
                <p className="mt-2">{section.summary}</p>
                <div className="mt-3 space-y-3">
                  {section.blocks.map((block, index) => <ContentBlock key={`${block.type}-${index}`} block={block} />)}
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

export default function HelpCenter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const initialTab = isHelpTabId(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const [activeTabId, setActiveTabId] = useState<HelpTabId>(initialTab as HelpTabId);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [printTabs, setPrintTabs] = useState<HelpTab[]>([getHelpTab(activeTabId)]);
  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const userRole = ((session?.user as { role?: UserRole } | undefined)?.role ?? 'user') as UserRole;
  const activeTab = getHelpTab(activeTabId);
  const terms = useMemo(() => normalizeSearch(searchQuery), [searchQuery]);

  const results = useMemo<SearchResult[]>(() => {
    if (terms.length === 0) return [];
    return HELP_TABS.flatMap((tab) =>
      tab.sections.map((section) => ({
        tab,
        section,
        score: rankSection(tab, section, terms),
      }))
    )
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score || a.section.title.localeCompare(b.section.title));
  }, [terms]);

  const groupedResults = useMemo(
    () => HELP_TABS.map((tab) => ({ tab, results: results.filter((result) => result.tab.id === tab.id) })).filter((group) => group.results.length > 0),
    [results]
  );

  const setTab = useCallback((tabId: HelpTabId, sectionId?: string) => {
    setActiveTabId(tabId);
    setExportOpen(false);
    const hash = sectionId ? `#${sectionId}` : '';
    router.push(`/help?tab=${tabId}${hash}`, { scroll: false });

    if (sectionId) {
      window.setTimeout(() => {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target?.focus({ preventScroll: true });
      }, 80);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [router]);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isHelpTabId(tabParam)) setActiveTabId(tabParam);
  }, [searchParams]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setExportOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!window.location.hash) return;
    const sectionId = window.location.hash.slice(1);
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ block: 'start' }), 80);
  }, [activeTabId]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % HELP_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + HELP_TABS.length) % HELP_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = HELP_TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = HELP_TABS[nextIndex];
    setTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const download = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportGuide = (scope: HelpExportScope, format: HelpExportFormat) => {
    const tabs = scope === 'current' ? [activeTab] : HELP_TABS;
    const generatedAt = new Date().toISOString();
    const content = format === 'md'
      ? buildHelpMarkdown(tabs, generatedAt)
      : buildHelpJson(tabs, generatedAt);
    download(
      content,
      getHelpExportFilename(tabs, format),
      format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'
    );
    setExportOpen(false);
    setExportStatus(`${scope === 'current' ? activeTab.label : 'Complete guide'} exported as ${format.toUpperCase()}.`);
  };

  const printGuide = (scope: HelpExportScope) => {
    setPrintTabs(scope === 'current' ? [activeTab] : HELP_TABS);
    setExportOpen(false);
    window.setTimeout(() => window.print(), 80);
  };

  const openSearchResult = (result: SearchResult) => {
    setSearchQuery('');
    setTab(result.tab.id, result.section.id);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-white">
      <style jsx global>{`
        @media print {
          body { background: white !important; color: black !important; }
          .help-screen-only { display: none !important; }
          .help-print-only { display: block !important; }
          .help-print-only * { color: black !important; box-shadow: none !important; }
          .help-print-only pre { white-space: pre-wrap !important; overflow-wrap: anywhere; border: 1px solid #999; }
          .help-print-only table { min-width: 0 !important; width: 100% !important; }
          .help-print-only button { display: none !important; }
          @page { margin: 16mm; }
        }
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto !important; }
        }
      `}</style>

      <div className="help-screen-only">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Link
                  href="/chat"
                  className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-900 dark:hover:text-white"
                  aria-label="Back to Chat"
                >
                  <ArrowLeft size={20} />
                </Link>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">Help Center</h1>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      Same guide for every role
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Learn the platform, Main Chat, portal Workspaces, and Agent Bot integrations.</p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 sm:w-[360px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search all help topics..."
                    aria-label="Search all Help Center topics"
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-20 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                      className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-slate-800 dark:hover:text-white"
                      aria-label="Clear Help search"
                    >
                      <X size={16} />
                    </button>
                  ) : (
                    <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-800">⌘/Ctrl K</kbd>
                  )}
                </div>

                <div ref={exportRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setExportOpen((open) => !open)}
                    aria-expanded={exportOpen}
                    aria-haspopup="menu"
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:w-auto"
                  >
                    <Download size={17} aria-hidden="true" />
                    Export
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                  {exportOpen && (
                    <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-full min-w-[290px] overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900 sm:w-[310px]">
                      {(['current', 'complete'] as const).map((scope) => (
                        <div key={scope} className="p-1">
                          <p className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            {scope === 'current' ? `Current tab — ${activeTab.label}` : 'Complete four-tab guide'}
                          </p>
                          <div className="grid grid-cols-3 gap-1">
                            <button role="menuitem" type="button" onClick={() => exportGuide(scope, 'md')} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                              <FileText size={17} /> Markdown
                            </button>
                            <button role="menuitem" type="button" onClick={() => exportGuide(scope, 'json')} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                              <FileJson size={17} /> JSON
                            </button>
                            <button role="menuitem" type="button" onClick={() => printGuide(scope)} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                              <Printer size={17} /> Print/PDF
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <nav className="mt-4 overflow-x-auto" aria-label="Help Center sections">
              <div role="tablist" aria-label="Help topics" className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
                {HELP_TABS.map((tab, index) => {
                  const Icon = TAB_ICONS[tab.icon];
                  const selected = activeTabId === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(element) => { tabRefs.current[tab.id] = element; }}
                      id={`help-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`help-panel-${tab.id}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setTab(tab.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, index)}
                      className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${selected ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {terms.length > 0 ? (
            <div aria-live="polite">
              <div className="mb-6 flex flex-col gap-1">
                <h2 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Search results</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {results.length} {results.length === 1 ? 'result' : 'results'} for “{searchQuery}” across all four tabs
                </p>
              </div>
              {results.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                  <Search className="mx-auto text-slate-300 dark:text-slate-600" size={36} />
                  <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">No matching help topics</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Try a role, feature, command, setup task, error, or integration term.</p>
                </div>
              ) : (
                <div className="space-y-7">
                  {groupedResults.map((group) => {
                    const Icon = TAB_ICONS[group.tab.icon];
                    return (
                      <section key={group.tab.id} aria-labelledby={`search-group-${group.tab.id}`}>
                        <div className="mb-3 flex items-center gap-2">
                          <Icon size={17} className="text-blue-600 dark:text-blue-400" aria-hidden="true" />
                          <h3 id={`search-group-${group.tab.id}`} className="font-bold text-slate-900 dark:text-white">{group.tab.label}</h3>
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{group.results.length}</span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {group.results.map((result) => (
                            <button
                              key={`${result.tab.id}-${result.section.id}`}
                              type="button"
                              onClick={() => openSearchResult(result)}
                              className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <h4 className="font-semibold text-slate-900 dark:text-white">{result.section.title}</h4>
                                <ExternalLink className="mt-0.5 shrink-0 text-slate-400" size={15} aria-hidden="true" />
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{result.section.summary}</p>
                              <div className="mt-3"><AudienceBadges audiences={result.section.audiences} /></div>
                            </button>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
              <aside className="hidden lg:block">
                <div className="sticky top-44 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                  <p className="px-2 pb-2 text-xs font-bold uppercase tracking-wider text-slate-400">On this tab</p>
                  <nav aria-label={`${activeTab.label} sections`} className="space-y-0.5">
                    {activeTab.sections.map((section) => (
                      <a key={section.id} href={`#${section.id}`} className="block rounded-lg px-2 py-2 text-sm leading-5 text-slate-600 hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
                        {section.title}
                      </a>
                    ))}
                  </nav>
                </div>
              </aside>

              <div className="min-w-0">
                <div className="mb-5 lg:hidden">
                  <label htmlFor="help-section-select" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Jump to a section</label>
                  <select
                    id="help-section-select"
                    defaultValue=""
                    onChange={(event) => {
                      if (event.target.value) setTab(activeTab.id, event.target.value);
                    }}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  >
                    <option value="" disabled>Select a section</option>
                    {activeTab.sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
                  </select>
                </div>

                <section
                  id={`help-panel-${activeTab.id}`}
                  role="tabpanel"
                  aria-labelledby={`help-tab-${activeTab.id}`}
                >
                  <div className="mb-7 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-6 text-white shadow-lg sm:p-8">
                    <div className="flex items-start gap-4">
                      {(() => {
                        const Icon = TAB_ICONS[activeTab.icon];
                        return <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15"><Icon size={22} /></span>;
                      })()}
                      <div>
                        <h2 className="text-2xl font-bold sm:text-3xl">{activeTab.label}</h2>
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-50 sm:text-base">{activeTab.description}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-5">
                    {activeTab.sections.map((section) => (
                      <HelpSectionCard key={section.id} section={section} userRole={userRole} />
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </main>

        <p className="sr-only" role="status" aria-live="polite">{exportStatus}</p>
      </div>

      <PrintableTabs tabs={printTabs} />
    </div>
  );
}
