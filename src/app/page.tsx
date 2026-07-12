'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import BotIcon from '@/components/ui/BotIcon';
import {
  Bot,
  ArrowRight,
  ShieldCheck,
  Blocks,
  Globe,
  Database,
  Network,
  Cpu,
  Layers,
  Terminal,
  Settings,
  Key,
  FileText,
  Layout,
  ExternalLink,
  Lock,
  Wrench,
  Search,
  Share2,
  Code,
  Sparkles,
  Plus,
  FileCode,
  ChevronDown,
  ChevronUp,
  Download,
  Activity,
  Play,
  FileCheck,
  Server,
  Zap,
  Users,
  Check,
  ArrowUpRight,
  Star,
  Clock,
  Mic
} from 'lucide-react';

const SIGN_IN_URL = '/auth/signin?callbackUrl=/chat';

export default function LandingPage() {
  const { status } = useSession();
  const router = useRouter();
  const [brandingName, setBrandingName] = useState('AI Assistant');
  const [brandingBotIcon, setBrandingBotIcon] = useState('policy');

  // Interactive UI States
  const [activeTab, setActiveTab] = useState<'rag' | 'agents' | 'api' | 'commands'>('rag');
  const [typedPrompt, setTypedPrompt] = useState('');
  const [typedResponse, setTypedResponse] = useState('');
  const [typingStage, setTypingStage] = useState(0); // 0: typing prompt, 1: thinking, 2: streaming response, 3: complete (charts & files), 4: reset pause
  const [isThoughtExpanded, setIsThoughtExpanded] = useState(true);

  // Rotating header words
  const ROTATING_WORDS = ['Government Staff', 'Sovereign Enterprise', 'Secure Workspaces', 'Autonomous Tasks'];
  const [rotatingIndex, setRotatingIndex] = useState(0);

  // Redirect authenticated users to chat
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/chat');
    }
  }, [status, router]);

  // Load branding
  useEffect(() => {
    fetch('/api/branding')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.botName) setBrandingName(data.botName);
        if (data?.botIcon) setBrandingBotIcon(data.botIcon);
      })
      .catch(() => {});
  }, []);

  // Word rotator effect
  useEffect(() => {
    const interval = setInterval(() => {
      setRotatingIndex((prev) => (prev + 1) % ROTATING_WORDS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // Simulated browser typing and state engine
  const targetPrompt = '/diagram compliance review of our cloud policy and outline the migration flowchart';
  const targetResponse = "I've retrieved and analyzed the relevant guidelines from the Governance category. Based on [1] Section 4.2 (Data Sovereignty) and [2] Section 9.1 (Audit Controls), your policy complies with standard mandates except for data residency rules. Below is the generated flowchart of the migration pipeline and the downloadable compliance summary:";
  
  const citations = [
    { label: '[1]', filename: 'cloud_data_sovereignty_2026.pdf' },
    { label: '[2]', filename: 'compliance_audit_directives.pdf' }
  ];

  const thinkingLogs = [
    'Retrieving context from Qdrant collection: policy_governance...',
    'Querying FalkorDB Graph KB for cross-department relationships...',
    'Reranking top-k chunks with local BGE Cross-Encoder...',
    'Running compliance-checker tool & diagram-gen engine...'
  ];

  // Simulator typing loop
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (typingStage === 0) {
      // Typing User Prompt
      if (typedPrompt.length < targetPrompt.length) {
        timer = setTimeout(() => {
          setTypedPrompt(targetPrompt.slice(0, typedPrompt.length + 1));
        }, 30);
      } else {
        // Switch to thinking state
        timer = setTimeout(() => {
          setTypingStage(1);
        }, 1000);
      }
    } else if (typingStage === 1) {
      // Simulating "thinking" delay
      timer = setTimeout(() => {
        setTypingStage(2);
      }, 2500);
    } else if (typingStage === 2) {
      // Typing Assistant Response
      if (typedResponse.length < targetResponse.length) {
        timer = setTimeout(() => {
          setTypedResponse(targetResponse.slice(0, typedResponse.length + 3));
        }, 15);
      } else {
        // Complete (render charts/files)
        timer = setTimeout(() => {
          setTypingStage(3);
        }, 500);
      }
    } else if (typingStage === 3) {
      // Full complete pause, then reset
      timer = setTimeout(() => {
        setTypingStage(4);
      }, 8000);
    } else if (typingStage === 4) {
      // Reset simulator states
      setTypedPrompt('');
      setTypedResponse('');
      setIsThoughtExpanded(true);
      setTypingStage(0);
    }

    return () => clearTimeout(timer);
  }, [typingStage, typedPrompt, typedResponse]);

  // Prevent flash of light mode/loading
  if (status === 'loading' || status === 'authenticated') {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-blue-500/30 selection:text-blue-200 overflow-x-hidden relative">
      
      {/* Background Radial Glow Nodes */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 left-1/3 w-[500px] h-[500px] bg-violet-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b12_1px,transparent_1px),linear-gradient(to_bottom,#1e293b12_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none -z-20 opacity-40" />

      {/* Premium Translucent Header */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-slate-800/60 bg-slate-950/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 group">
            <Link href="/" className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform duration-300">
              <BotIcon iconKey={brandingBotIcon} size={20} className="text-white" />
            </Link>
            <span className="text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-slate-100 to-slate-300 tracking-tight">
              {brandingName}
            </span>
          </div>

          <div className="flex items-center gap-6">
            <Link
              href={SIGN_IN_URL}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
            >
              Sign In <ArrowUpRight size={15} />
            </Link>
            <Link
              href={SIGN_IN_URL}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-all shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-98"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-16 pb-20 sm:pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          
          {/* Version Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-blue-500/20 bg-blue-500/5 text-xs font-semibold text-blue-400 mb-6 animate-pulse">
            <Sparkles size={13} />
            Enterprise v2.0 Released
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight text-white max-w-5xl mx-auto leading-[1.1]">
            AI-Powered Platform for{' '}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 block mt-2 sm:inline sm:mt-0">
              {ROTATING_WORDS[rotatingIndex]}
            </span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed">
            Deploy secure, custom AI assistants, automated agent loops, and document search. 
            Maintain total ownership over your data with local model routing and strict air-gapped readiness.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href={SIGN_IN_URL}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-lg transition-all shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25 active:scale-98 text-base group"
            >
              Get Started 
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="#maturity"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 bg-slate-900/60 hover:bg-slate-900 text-slate-300 hover:text-white font-semibold rounded-lg border border-slate-800 transition-all active:scale-98 text-base"
            >
              Explore Architecture
            </a>
          </div>
        </div>
      </section>

      {/* Interactive Browser Chat Simulator */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 mb-24 relative z-20">
        <div className="rounded-xl border border-slate-800/80 bg-slate-950/60 shadow-2xl overflow-hidden backdrop-blur-md">
          
          {/* Mock Browser Header - URL pointing to ai.abhirup.app */}
          <div className="bg-slate-900/80 px-4 py-3 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500/40" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/40" />
              <span className="w-3 h-3 rounded-full bg-green-500/40" />
              <span className="text-xs text-slate-400 font-mono ml-4 select-all">https://ai.abhirup.app</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 min-h-[460px]">
            {/* Mock Sidebar - Threads ordered by Favorites and Dates */}
            <div className="hidden md:flex flex-col bg-slate-950/90 border-r border-slate-800/60 p-3 justify-between">
              <div className="space-y-4">
                
                {/* Favorites Threads */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 px-2 tracking-wider uppercase flex items-center gap-1.5 mb-1.5">
                    <Star size={11} className="text-amber-400 fill-amber-400" />
                    <span>Favorites</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-blue-400 bg-blue-500/10 border border-blue-500/10 cursor-pointer">
                      <FileText size={13} />
                      <span className="truncate">Cloud Policy Check</span>
                    </div>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-slate-200 cursor-pointer transition-colors">
                      <FileCode size={13} />
                      <span className="truncate">HTML Generator Spec</span>
                    </div>
                  </div>
                </div>

                {/* Date-sorted Threads */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 px-2 tracking-wider uppercase flex items-center gap-1.5 mb-1.5">
                    <Clock size={11} className="text-slate-400" />
                    <span>Today</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-slate-200 cursor-pointer transition-colors">
                      <FileCheck size={13} />
                      <span className="truncate">Compliance Migration</span>
                    </div>
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:bg-slate-900 hover:text-slate-200 cursor-pointer transition-colors">
                      <Layers size={13} />
                      <span className="truncate">Security Audit Directives</span>
                    </div>
                  </div>
                </div>

                {/* Older dates */}
                <div>
                  <div className="text-[10px] font-bold text-slate-500 px-2 tracking-wider uppercase flex items-center gap-1.5 mb-1.5">
                    <Clock size={11} className="text-slate-500" />
                    <span>Yesterday</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:bg-slate-900/40 hover:text-slate-300 cursor-pointer transition-colors">
                      <FileText size={13} />
                      <span className="truncate">Custom Chatbot Seeding</span>
                    </div>
                  </div>
                </div>

              </div>

              <div className="p-2 border-t border-slate-900">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300">
                    AD
                  </div>
                  <div className="text-[11px] truncate">
                    <p className="font-semibold text-slate-300">Staff Admin</p>
                    <p className="text-slate-500">Super Admin</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Simulated Chat Feed */}
            <div className="md:col-span-3 flex flex-col justify-between bg-slate-900/20">
              {/* Chat Output Area */}
              <div className="p-6 overflow-y-auto space-y-4 max-h-[380px]">
                
                {/* User Message */}
                {typedPrompt && (
                  <div className="flex items-start gap-3 justify-end">
                    <div className="flex flex-col items-end max-w-[85%]">
                      <div className="bg-blue-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 text-sm shadow-md">
                        {typedPrompt}
                      </div>
                      <span className="text-[10px] text-slate-500 mt-1">Just now</span>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-semibold text-slate-300 shrink-0">
                      U
                    </div>
                  </div>
                )}

                {/* Simulated Loading/Thinking Log */}
                {typingStage >= 1 && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      PB
                    </div>
                    <div className="flex-1 space-y-2 max-w-[85%]">
                      
                      {/* Accordion thought block */}
                      <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 overflow-hidden">
                        <button
                          onClick={() => setIsThoughtExpanded(!isThoughtExpanded)}
                          className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-400 hover:bg-slate-900/40 hover:text-slate-200 transition-colors"
                        >
                          <span className="flex items-center gap-1.5 font-mono">
                            <Activity size={12} className="text-blue-400 animate-pulse" />
                            Agent Thinking Process ({typingStage === 1 ? 'Running...' : '4.2s completed'})
                          </span>
                          {isThoughtExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        
                        {isThoughtExpanded && (
                          <div className="px-3 pb-3 pt-1 border-t border-slate-900 font-mono text-[11px] text-slate-500 space-y-1">
                            {thinkingLogs.map((log, index) => {
                              const isCompleted = typingStage > 1 || index < 2;
                              return (
                                <div key={log} className="flex items-center gap-2">
                                  <span className={isCompleted ? "text-green-500" : "text-blue-400 animate-pulse"}>
                                    {isCompleted ? "✓" : "▶"}
                                  </span>
                                  <span className={isCompleted ? "text-slate-400" : "text-slate-500"}>{log}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Assistant Message Answer */}
                {typingStage >= 2 && typedResponse && (
                  <div className="flex items-start gap-3 animate-fade-in">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
                      PB
                    </div>
                    <div className="flex-1 space-y-4 max-w-[85%]">
                      <div className="bg-slate-900/60 rounded-2xl rounded-tl-none border border-slate-800/80 px-4 py-3 text-sm leading-relaxed text-slate-200 shadow-sm relative">
                        <p>{typedResponse}</p>

                        {/* Citations block when typing complete */}
                        {typingStage >= 3 && (
                          <div className="mt-3 pt-3 border-t border-slate-800/50 flex flex-wrap gap-2">
                            <span className="text-[11px] text-slate-500 self-center">Citations:</span>
                            {citations.map((cit) => (
                              <span
                                key={cit.label}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-mono cursor-pointer border border-slate-700/50 transition-colors"
                              >
                                <FileText size={10} />
                                {cit.filename}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Visual Flowchart Rendered when complete */}
                      {typingStage >= 3 && (
                        <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 space-y-3 animate-slide-up">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-400 tracking-wider uppercase">Generated Flowchart</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono">Mermaid Engine</span>
                          </div>
                          
                          {/* CSS simulated flowchart */}
                          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 py-2">
                            <div className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900/80 text-center text-xs text-slate-300 min-w-[100px] shadow-sm">
                              Upload Policy
                            </div>
                            <div className="text-slate-600">→</div>
                            <div className="px-3 py-1.5 rounded border border-red-500/30 bg-red-500/5 text-center text-xs text-red-400 min-w-[100px] shadow-sm">
                              Detect Conflict
                            </div>
                            <div className="text-slate-600">→</div>
                            <div className="px-3 py-1.5 rounded border border-green-500/30 bg-green-500/5 text-center text-xs text-green-400 min-w-[100px] shadow-sm">
                              Local Host Fix
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Generated PDF File download badge when complete */}
                      {typingStage >= 3 && (
                        <div className="flex items-center justify-between p-3 rounded-xl border border-slate-800/80 bg-slate-950/50 hover:bg-slate-900/30 cursor-pointer transition-all animate-slide-up">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded bg-red-500/10 flex items-center justify-center border border-red-500/20 text-red-400">
                              <FileCheck size={18} />
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-slate-200">compliance_migration_plan.pdf</p>
                              <p className="text-[10px] text-slate-500">2.4 MB · Document Generation Tool</p>
                            </div>
                          </div>
                          <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                            <Download size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>

              {/* Chat Input Bar - With + uploader, Model selector pill, Ollama + Qdrant: Connected pill, audio mic, and play button */}
              <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 space-y-2.5">
                
                {/* Control elements on top of text box */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  
                  {/* Left Controls: File Uploader & Model Selector Dropdown */}
                  <div className="flex items-center gap-2">
                    <button className="w-7 h-7 bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white rounded flex items-center justify-center border border-slate-800 transition-colors">
                      <Plus size={14} />
                    </button>
                    
                    {/* Model selector mockup */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-900/80 text-[11px] text-slate-300 rounded border border-slate-800 cursor-pointer hover:bg-slate-800 transition-colors">
                      <Cpu size={11} className="text-blue-400" />
                      <span className="font-semibold">Ollama: Qwen-2.5-14B (Local)</span>
                      <ChevronDown size={11} className="text-slate-500" />
                    </div>
                  </div>

                  {/* Right Status Indicator: Connected node info */}
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-950 rounded text-[10px] text-slate-400 border border-slate-800/60 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span>Ollama + Qdrant: Connected</span>
                  </div>

                </div>

                {/* Input Text box with mic and send button */}
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      readOnly
                      placeholder="Ask AI Assistant or type '/' command..."
                      className="w-full bg-slate-900/60 border border-slate-800/80 rounded-lg pl-3.5 pr-10 py-2.5 text-sm text-slate-300 focus:outline-none placeholder-slate-600"
                      value={typedPrompt}
                    />
                    
                    {/* Audio mic STT icon inside input box */}
                    <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                      <Mic size={14} />
                    </button>
                  </div>
                  
                  <button className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/10 transition-colors">
                    <Play size={14} className="fill-current" />
                  </button>
                </div>

              </div>

            </div>
          </div>

        </div>
      </section>

      {/* Pillars Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-32 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/20 p-8 hover:border-blue-500/30 hover:bg-slate-900/30 transition-all duration-300 group">
            <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center mb-6 text-blue-400 group-hover:scale-105 transition-transform duration-300">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-3">Absolute Sovereignty</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Run entirely on your infrastructure. Vector indices (Qdrant), databases, caches, and files remain local, satisfying air-gapped standards.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/20 p-8 hover:border-indigo-500/30 hover:bg-slate-900/30 transition-all duration-300 group">
            <div className="w-12 h-12 bg-indigo-500/10 border border-indigo-500/20 rounded-xl flex items-center justify-center mb-6 text-indigo-400 group-hover:scale-105 transition-transform duration-300">
              <Server size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-3">Multi-Route LLM Connections</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Ensure model survivability by routing requests over direct SDK connections, LiteLLM gateway proxies, local Ollama hosts, or Ollama Cloud instantly.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/20 p-8 hover:border-violet-500/30 hover:bg-slate-900/30 transition-all duration-300 group">
            <div className="w-12 h-12 bg-violet-500/10 border border-violet-500/20 rounded-xl flex items-center justify-center mb-6 text-violet-400 group-hover:scale-105 transition-transform duration-300">
              <Zap size={24} />
            </div>
            <h3 className="text-lg font-bold text-white mb-3">Expansive Tool Suite</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              Equip your bots with 20+ functional integrations: document layout engines, Tavily search, website analysis, code profiling, and automated security scans.
            </p>
          </div>
        </div>
      </section>

      {/* Architecture Maturity Section */}
      <section id="maturity" className="py-24 border-y border-slate-900 bg-slate-950/50 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-indigo-500/5 rounded-full blur-[140px] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Matured Enterprise Architecture
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Engineered with proven security guardrails, granular RBAC models, and highly optimized retrieval indices.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* RAG */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                  <Network size={18} />
                </div>
                <h3 className="font-bold text-white text-base">State-of-the-Art RAG</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Combines high-performance collection-based semantic retrieval via Qdrant with FalkorDB Graph Knowledge Bases. Includes local BGE Cross-Encoder reranking models and persistent memory layers.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Vector Collection</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Graph DB</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">BGE Rerank</span>
              </div>
            </div>

            {/* Category KB & Segregation */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                  <Users size={18} />
                </div>
                <h3 className="font-bold text-white text-base">Granular Segmentation</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Strict multi-tenant resource structures. Restrict users and coordinate division parameters via category-scoped Knowledge Bases. Admin dashboard lets superusers manage specific sections without cross-contamination.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Category Scoped</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">User Scopes</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">RBAC</span>
              </div>
            </div>

            {/* Zero-code custom agent bots */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-violet-500/10 flex items-center justify-center text-violet-400 border border-violet-500/20">
                  <Settings size={18} />
                </div>
                <h3 className="font-bold text-white text-base">Zero-Code Agent Bots</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Build and deploy custom agent bots directly from the Admin console. Manage prompt variables, model configurations, system histories, scopes, and generate programmatically integrated API keys instantly.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Config UI</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">API Keys</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Versions</span>
              </div>
            </div>

            {/* Custom Skills */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-pink-500/10 flex items-center justify-center text-pink-400 border border-pink-500/20">
                  <Blocks size={18} />
                </div>
                <h3 className="font-bold text-white text-base">Modular System Skills</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Extend platform competence with custom system skills. Define localized prompt templates, custom instruction cards, and specific tool parameters inside a unified, database-seeded directory.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Prompt Seeding</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Task Injection</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Skills Directory</span>
              </div>
            </div>

            {/* Tools Ecosystem */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/20">
                  <Wrench size={18} />
                </div>
                <h3 className="font-bold text-white text-base">20+ Advanced Tools</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Complete tasks via document rendering engines (Word, Excel, PowerPoint, PDF generator), page analytics, Tavily search, dependency mapping, cyber compliance tools, and server-side screenshot systems.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Document Generators</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Cyber Scanners</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Web RAG</span>
              </div>
            </div>

            {/* Security Audit */}
            <div className="rounded-2xl border border-slate-900 bg-slate-900/40 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded bg-amber-500/10 flex items-center justify-center text-amber-400 border border-amber-500/20">
                  <Lock size={18} />
                </div>
                <h3 className="font-bold text-white text-base">Production Audited</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Zero telemetry analytics, database encryption for data sources (`DATA_SOURCE_ENCRYPTION_KEY`), strict CORS allowlists, non-root Docker runner files, and automated static security analysis.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">AES Encryption</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Non-Root Docker</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-800">Zero Telemetry</span>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* Deployment Modes / Organization Focus */}
      <section className="py-24 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Flexible Integration Modes
          </h2>
          <p className="mt-4 text-slate-400 leading-relaxed">
            Integrate AI directly where your enterprise operates, from dynamic browser chats to external sites and background workflows.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Assistant Mode */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950 p-8 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 border border-blue-500/20">
                <Bot size={22} />
              </div>
              <h3 className="text-xl font-bold text-white">Interactive Assistant</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Multi-turn conversation panel with real-time SSE streaming. Seamlessly invoke 16 predefined slash commands (like `/diagram`, `/gantt`, `/slide`) to instantly construct and download production-grade outputs.
              </p>
            </div>
            <div className="border-t border-slate-900 pt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-blue-400" />
                <span>Deep Document Citation</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-blue-400" />
                <span>Autocomplete Slash Menu</span>
              </div>
            </div>
          </div>

          {/* Embedded Widget */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950 p-8 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/20">
                <Layout size={22} />
              </div>
              <h3 className="text-xl font-bold text-white">Embeddable Widgets</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Drop high-speed interactive chat widgets onto existing company intranets or websites via iframe codes (`/e/[slug]`). Configure allowed domains dynamically in the Admin panel to automatically assert frame CSP parameters.
              </p>
            </div>
            <div className="border-t border-slate-900 pt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-indigo-400" />
                <span>Strict Origin-Allowlists (CSP)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-indigo-400" />
                <span>Workspace Branding Overrides</span>
              </div>
            </div>
          </div>

          {/* Agent Framework */}
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/60 to-slate-950 p-8 space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-11 h-11 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 border border-violet-500/20">
                <Terminal size={22} />
              </div>
              <h3 className="text-xl font-bold text-white">Autonomous Agent Loop</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Unlocks recursive subagent reasoning using Planner → Executor → Checker → Summarizer pathways. Tracks token expenditure limits and requires human confirmation (HITL approval) before running expensive or complex tools.
              </p>
            </div>
            <div className="border-t border-slate-900 pt-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-violet-400" />
                <span>Tool Safety Gating</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Check size={14} className="text-violet-400" />
                <span>Real-Time SSE Loop Progress</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Feature Showcase Tabs (Interactive Exploration) */}
      <section className="py-24 bg-slate-900/10 border-t border-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Deep-Dive Platform Features
            </h2>
            <p className="mt-4 text-slate-400">
              Toggle the sections below to investigate details of our RAG execution, agent loops, developer APIs, and custom commands.
            </p>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-wrap justify-center gap-2.5 mb-12">
            {[
              { id: 'rag', label: 'Semantic & Graph RAG', icon: Database },
              { id: 'agents', label: 'Autonomous Pipelines', icon: Cpu },
              { id: 'api', label: 'Developer API Bots', icon: Code },
              { id: 'commands', label: 'Power Slash Commands', icon: Terminal }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/10'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800/80 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Display Screens */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-8 min-h-[300px] flex flex-col justify-between backdrop-blur-md">
            
            {activeTab === 'rag' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center animate-fade-in">
                <div className="space-y-5">
                  <div className="inline-flex px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400 uppercase tracking-wider">
                    Core RAG Engine
                  </div>
                  <h3 className="text-2xl font-bold text-white">Vector Ingestion Coupled with Graph DBs</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Upon document upload, files undergo custom chunking, are embedded locally via text-embedding models, and are stored in workspace-isolated Qdrant collections.
                  </p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    With Graph-RAG enabled, entities are extracted and cross-referenced in FalkorDB, unlocking deep multi-hop relationship queries that standard vector models fail to answer. Local BGE rerankers guarantee maximum utility.
                  </p>
                </div>
                {/* Visual Representation */}
                <div className="bg-slate-900/40 p-6 rounded-xl border border-slate-800 space-y-3 font-mono text-[11px] text-slate-400">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-200 font-bold">RAG Pipeline Stage</span>
                    <span className="text-blue-400 font-semibold">Qdrant + FalkorDB</span>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                    <p className="text-slate-300 font-bold">1. Multi-Format Chunking & Embed</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">Mammoth / ExcelJS / OCR → Semantic Tokens → Embed</p>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                    <p className="text-slate-300 font-bold">2. Dual Retrieval Querying</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">Vector Search: Top-k chunks + Graph Query: Entity Neighbors</p>
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800">
                    <p className="text-slate-300 font-bold">3. Cross-Encoder Reranking</p>
                    <p className="text-slate-500 text-[10px] mt-0.5">BGE Reranker weights context scores to ensure optimal LLM accuracy</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'agents' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center animate-fade-in">
                <div className="space-y-5">
                  <div className="inline-flex px-2.5 py-1 rounded bg-violet-500/10 border border-violet-500/20 text-xs font-semibold text-violet-400 uppercase tracking-wider">
                    Autonomous Loops
                  </div>
                  <h3 className="text-2xl font-bold text-white">Dynamic Planner-Executor-Checker Cycles</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Break down complex commands into sequenced tasks. AI Assistant utilizes a structured state machine with subagent execution routines to independently analyze, search, generate material, and verify results.
                  </p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    **Tool Safety Gating** automatically audits the tools requested. If an agent tries to execute a costly or high-impact tool (like `doc_gen` or custom `function_apis`), it pauses and requests direct administrative sign-off via a Human-In-The-Loop interface.
                  </p>
                </div>
                {/* Visual Representation */}
                <div className="bg-slate-900/40 p-6 rounded-xl border border-slate-800 space-y-3 font-mono text-[11px] text-slate-400">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-slate-200 font-bold">Execution Loop Steps</span>
                    <span className="text-violet-400 font-semibold">Budget Safe Gating</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold">1</span>
                    <p className="text-slate-300 font-bold">Planner: Formulation of subtasks & allocated budgets</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold">1</span>
                    <p className="text-slate-300 font-bold">Executor: Sequential tool triggering & RAG searches</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold">2</span>
                    <p className="text-red-400/90 font-bold flex items-center gap-1">
                      <span>⚠ Tool Safety Gate: Doc_gen requested (Pause & Approve)</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold">3</span>
                    <p className="text-slate-300 font-bold">Checker & Summarizer: Error check, compliance pass, and stream output</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'api' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center animate-fade-in">
                <div className="space-y-5">
                  <div className="inline-flex px-2.5 py-1 rounded bg-teal-500/10 border border-teal-500/20 text-xs font-semibold text-teal-400 uppercase tracking-wider">
                    Programmatic Bots
                  </div>
                  <h3 className="text-2xl font-bold text-white">Deploy Programmatic Agent Bots with API Keys</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Expose internal AI capabilities directly through clean developer REST endpoints. Generate dedicated API keys (`ab_pk_*`) to request asynchronous agent tasks programmatically.
                  </p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Each bot tracks comprehensive execution history, metrics analytics, and handles multi-tier file uploads and programmatic output downloads.
                  </p>
                </div>
                {/* Visual Representation */}
                <div className="bg-slate-900/40 p-5 rounded-xl border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                    <span className="text-[11px] text-slate-300 font-mono">API POST Invoke Request</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-teal-500/10 text-teal-400 font-mono font-bold">REST Spec</span>
                  </div>
                  <pre className="text-[10px] text-teal-300 font-mono bg-slate-950 p-4 rounded-lg overflow-x-auto leading-relaxed">
{`curl -X POST "https://ai.abhirup.app/api/agent-bots/compliance/invoke" \\
  -H "Authorization: Bearer ab_pk_live_d8a92..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Analyze policy rules on cloud uploads",
    "async": true
  }'

// Returns 202 Accepted with {"jobId": "job_09e8b..."}`}
                  </pre>
                </div>
              </div>
            )}

            {activeTab === 'commands' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center animate-fade-in">
                <div className="space-y-5">
                  <div className="inline-flex px-2.5 py-1 rounded bg-pink-500/10 border border-pink-500/20 text-xs font-semibold text-pink-400 uppercase tracking-wider">
                    Slash Commands
                  </div>
                  <h3 className="text-2xl font-bold text-white">Predefined Slash Commands & Instant Artifacts</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Supercharge chat capabilities. Administer a dedicated registry of 16 predefined commands to bypass multi-turn conversations and trigger specific automated templates instantly.
                  </p>
                  <p className="text-slate-400 text-sm leading-relaxed">
                    Users get interactive autocompleting menus to draft Mermaid diagrams, line charts, gantt schedules, Excel sheets, and professional layout PDFs instantly from prompts.
                  </p>
                </div>
                {/* Visual Representation */}
                <div className="bg-slate-900/40 p-5 rounded-xl border border-slate-800 grid grid-cols-2 gap-2 font-mono text-[10px]">
                  {[
                    { cmd: '/diagram', desc: 'Flowcharts, Sequence, C4' },
                    { cmd: '/chart', desc: 'Line, Bar, Infographics' },
                    { cmd: '/gantt', desc: 'Schedules & Timelines' },
                    { cmd: '/pdf', desc: 'Docgen PDF Reports' },
                    { cmd: '/docx', desc: 'Editable Word Docs' },
                    { cmd: '/sheet', desc: 'Structured Excel XLSX' },
                    { cmd: '/slide', desc: 'PowerPoint slide deck' },
                    { cmd: '/cyber', desc: 'SSL, DNS & Load tests' }
                  ].map((item) => (
                    <div key={item.cmd} className="p-2 bg-slate-950/60 border border-slate-800 rounded flex flex-col justify-between">
                      <span className="text-pink-400 font-bold">{item.cmd}</span>
                      <span className="text-slate-500 text-[9px] mt-0.5">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>

        </div>
      </section>

      {/* Structured Provider Section - Refined Routes Classification */}
      <section className="py-24 border-t border-slate-900 bg-slate-950 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="text-center mb-16 max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Flexible Multi-Route Model Connections
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              AI Assistant leverages unique internal communication pathways to connect with any local or cloud LLM, guaranteeing zero-downtime performance.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            
            {/* Route 1: Direct SDK Integration */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow shadow-orange-500/30" />
                <h3 className="font-bold text-white text-base">Route 1: Direct SDK Integration</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Connects directly to models using native software development kits. Bypasses aggregation errors to deliver reliable tool call streaming and rapid JSON assembly.
              </p>
              <div className="pt-2 border-t border-slate-900 flex flex-wrap gap-1.5 font-semibold text-[11px] text-orange-400">
                <span>Anthropic</span>
                <span className="text-slate-700">·</span>
                <span>OpenAI</span>
                <span className="text-slate-700">·</span>
                <span>Mistral</span>
                <span className="text-slate-700">·</span>
                <span>DeepSeek</span>
                <span className="text-slate-700">·</span>
                <span>Moonshot</span>
              </div>
            </div>

            {/* Route 2: Unified Aggregators */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow shadow-blue-500/30" />
                <h3 className="font-bold text-white text-base">Route 2: Unified Aggregators</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Integrates with centralized proxies, cloud model registries, and API brokers to simplify management and facilitate immediate failovers.
              </p>
              <div className="pt-2 border-t border-slate-900 flex flex-wrap gap-1.5 font-semibold text-[11px] text-blue-400">
                <span>Azure AI Foundry</span>
                <span className="text-slate-700">·</span>
                <span>Fireworks AI</span>
                <span className="text-slate-700">·</span>
                <span>Ollama Cloud</span>
              </div>
            </div>

            {/* Route 3: Air-Gapped Local */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/20 p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow shadow-emerald-500/30" />
                <h3 className="font-bold text-white text-base">Route 3: Air-Gapped Local</h3>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Operates completely local within sovereign networks. Integrates with on-premise inference engines to guarantee zero subscription overheads and zero data leakage.
              </p>
              <div className="pt-2 border-t border-slate-900 text-emerald-400 font-semibold text-[11px]">
                <span>All models available under Ollama local</span>
              </div>
            </div>

          </div>

        </div>
      </section>

      {/* CTA Section */}
      <section className="py-28 text-center relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-6">
          <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
            Take Control of Your Enterprise AI
          </h2>
          <p className="text-slate-400 max-w-2xl mx-auto text-base leading-relaxed">
            Deploy AI Assistant on your own cloud, local server, or secure VM container. Open-source, self-hosted, and designed for military-grade sovereignty.
          </p>
          <div className="pt-4">
            <Link
              href={SIGN_IN_URL}
              className="inline-flex items-center gap-2 px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-lg transition-all shadow-lg shadow-blue-500/15 hover:shadow-blue-500/25 active:scale-98 text-base group"
            >
              Sign In to Your Workspace
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* Polished Footer */}
      <footer className="border-t border-slate-900 py-12 bg-slate-950/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="w-7 h-7 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
                <BotIcon iconKey={brandingBotIcon} size={15} />
              </div>
              <span>&copy; {new Date().getFullYear()} {brandingName} · Self-hosted & Sovereign</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <Link
                href="/privacy-policy"
                className="hover:text-slate-300 transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/service-terms"
                className="hover:text-slate-300 transition-colors"
              >
                Terms of Service
              </Link>
            </div>
          </div>
          <p className="text-xs text-slate-500 font-mono">
            Powered by Kysely, Qdrant, FalkorDB and Ollama
          </p>
        </div>
      </footer>

    </div>
  );
}
