'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  ArrowRight,
  ShieldCheck,
  Blocks,
  Globe,
  BarChart3,
  Target,
  Users,
  Puzzle,
  Building2,
  Shield,
  Headphones,
  Megaphone,
  GraduationCap,
  FileCheck,
  Brain,
} from 'lucide-react';

const SIGN_IN_URL = '/auth/signin?callbackUrl=/chat';

const VALUE_PROPS = [
  {
    icon: ShieldCheck,
    title: 'Complete Data Sovereignty',
    description:
      'All data remains on your infrastructure — databases, vector stores, and files never leave your control. Fully auditable open-source code.',
  },
  {
    icon: Blocks,
    title: 'No-Code AI Configuration',
    description:
      'Build and train custom skills, configure AI providers, and deploy workspace chat widgets — all from an admin dashboard.',
  },
  {
    icon: Globe,
    title: 'Deploy Anywhere',
    description:
      'Run on your own servers, air-gapped environments, or cloud. Switch freely between OpenAI, Anthropic, Gemini, Mistral, DeepSeek, or local models via Ollama.',
  },
];

const CAPABILITIES = [
  { name: 'Reporting & Visualisation', color: 'blue', icon: BarChart3, services: 'Reports, charts, diagrams, infographics' },
  { name: 'Planning', color: 'purple', icon: Target, services: 'Project management, strategy, roadmaps, work packages' },
  { name: 'Domain Specific', color: 'amber', icon: Users, services: 'Citizen feedback, surveys, pay review, translation, support' },
  { name: 'Integration & Automation', color: 'emerald', icon: Puzzle, services: 'ChatBots, agent bots, data integration' },
  { name: 'Enterprise Architecture', color: 'indigo', icon: Building2, services: 'Architecture diagrams, API specs, service simplification' },
  { name: 'Cyber Tools', color: 'cyan', icon: Shield, services: 'Security scans, SSL, DNS, load testing, WCAG audits' },
];

const CAPABILITY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  blue: { border: 'border-blue-400', bg: 'bg-blue-50', text: 'text-blue-600' },
  purple: { border: 'border-purple-400', bg: 'bg-purple-50', text: 'text-purple-600' },
  amber: { border: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-600' },
  emerald: { border: 'border-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  indigo: { border: 'border-indigo-400', bg: 'bg-indigo-50', text: 'text-indigo-600' },
  cyan: { border: 'border-cyan-400', bg: 'bg-cyan-50', text: 'text-cyan-600' },
};

const USE_CASES = [
  { icon: Building2, domain: 'Citizen Services', description: '24/7 portals for policies, procedures, permits' },
  { icon: Headphones, domain: 'Customer Support', description: 'AI helpdesk with knowledge base integration' },
  { icon: Megaphone, domain: 'Public Communications', description: 'Tailored messaging for different audiences' },
  { icon: GraduationCap, domain: 'Education & Training', description: 'Lesson plans, assessments, teaching aids' },
  { icon: FileCheck, domain: 'Policy & Compliance', description: 'RAG-powered Q&A with source citations' },
  { icon: Brain, domain: 'Task Automation', description: 'Autonomous agents for multi-step workflows' },
];

const PROVIDERS = [
  { name: 'OpenAI', models: 'GPT-4.1, GPT-5.x', dotColor: 'bg-green-500' },
  { name: 'Anthropic', models: 'Claude Sonnet/Haiku/Opus 4.5', dotColor: 'bg-orange-500' },
  { name: 'Google Gemini', models: '2.5 Pro/Flash, 1M context', dotColor: 'bg-blue-500' },
  { name: 'Mistral', models: 'Large 3, Small 3.2', dotColor: 'bg-orange-400' },
  { name: 'DeepSeek', models: 'Reasoner, Chat', dotColor: 'bg-purple-500' },
  { name: 'Fireworks AI', models: 'Open-source models', dotColor: 'bg-red-500' },
  { name: 'Ollama', models: 'Local models (Llama, Qwen, Phi)', dotColor: 'bg-gray-400', badge: 'Air-gapped ready' },
];

export default function LandingPage() {
  const { status } = useSession();
  const router = useRouter();
  const [brandingName, setBrandingName] = useState('Policy Bot');

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
      })
      .catch(() => {});
  }, []);

  // Show nothing while checking auth (prevents flash)
  if (status === 'loading' || status === 'authenticated') {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Nav */}
          <nav className="flex items-center justify-between py-6">
            <div className="flex items-center gap-2">
              <Bot size={28} className="text-blue-400" />
              <span className="text-xl font-bold">{brandingName}</span>
            </div>
            <Link
              href={SIGN_IN_URL}
              className="flex items-center gap-1 text-sm font-medium text-gray-300 hover:text-white transition-colors"
            >
              Sign In <ArrowRight size={16} />
            </Link>
          </nav>

          {/* Hero content */}
          <div className="py-16 sm:py-24 text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
              AI-Powered Platform for{' '}
              <span className="text-blue-400">Government & Enterprise</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto">
              Deploy AI solutions while maintaining complete control over your data.
              Open-source, self-hosted, and provider-agnostic.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href={SIGN_IN_URL}
                className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
              >
                Get Started <ArrowRight size={20} />
              </Link>
            </div>
          </div>
        </div>

        {/* Curved bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-white" style={{ clipPath: 'ellipse(70% 100% at 50% 100%)' }} />
      </section>

      {/* Value props - overlapping cards */}
      <section className="relative -mt-8 z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {VALUE_PROPS.map((prop) => (
            <div key={prop.title} className="bg-white rounded-2xl shadow-lg p-8">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
                <prop.icon size={24} className="text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{prop.title}</h3>
              <p className="text-gray-600 text-sm leading-relaxed">{prop.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900">Capabilities</h2>
          <span className="inline-block mt-3 px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full">
            More coming soon
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CAPABILITIES.map((cap) => {
            const colors = CAPABILITY_COLORS[cap.color];
            return (
              <div key={cap.name} className={`bg-white rounded-xl shadow-sm p-6 border-l-4 ${colors.border}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-9 h-9 ${colors.bg} rounded-lg flex items-center justify-center`}>
                    <cap.icon size={18} className={colors.text} />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm">{cap.name}</h3>
                </div>
                <p className="text-gray-600 text-sm">{cap.services}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">
            Deploy Across Your Organization
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {USE_CASES.map((uc) => (
              <div key={uc.domain} className="flex items-start gap-4 bg-white rounded-lg p-5 shadow-sm">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                  <uc.icon size={20} className="text-gray-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{uc.domain}</h3>
                  <p className="text-gray-500 text-sm mt-1">{uc.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LLM Providers */}
      <section className="py-20 bg-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">
            Works With Your Preferred AI Provider
          </h2>
          <p className="text-gray-500 text-center mb-12">
            Switch providers freely — no code changes needed
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {PROVIDERS.map((provider) => (
              <div key={provider.name} className="bg-white rounded-xl p-4 text-center shadow-sm">
                <div className={`w-3 h-3 ${provider.dotColor} rounded-full mx-auto mb-2`} />
                <p className="font-semibold text-gray-900 text-sm">{provider.name}</p>
                <p className="text-gray-500 text-xs mt-1">{provider.models}</p>
                {provider.badge && (
                  <span className="inline-block mt-2 px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-medium rounded-full">
                    {provider.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 text-center">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-6">Ready to get started?</h2>
          <Link
            href={SIGN_IN_URL}
            className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
          >
            Sign In <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 text-center text-sm text-gray-500">
        &copy; {new Date().getFullYear()} {brandingName} &middot; Powered by open source
      </footer>
    </div>
  );
}
