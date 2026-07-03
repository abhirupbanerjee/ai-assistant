'use client';

import {
  Bot,
  Landmark,
  Settings,
  DollarSign,
  BarChart3,
  FileText,
  Database,
  Activity,
  Layers,
  Globe,
  Server,
  ScrollText,
} from 'lucide-react';
import AiIcon from '@/components/ui/icons/AiIcon';

interface BotIconProps {
  /** The icon key from branding settings (e.g., 'policy', 'government', 'ai-icon') */
  iconKey?: string;
  /** Icon size in pixels (default: 24) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Maps branding icon keys to their React components.
 * Supports both Lucide icons and the custom AiIcon SVG component.
 */
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  government: Landmark,
  operations: Settings,
  finance: DollarSign,
  kpi: BarChart3,
  logs: FileText,
  data: Database,
  monitoring: Activity,
  architecture: Layers,
  internet: Globe,
  systems: Server,
  policy: ScrollText,
  'ai-icon': AiIcon,
};

/**
 * Shared BotIcon component that resolves a branding icon key to the
 * appropriate React component (Lucide or custom SVG).
 *
 * Falls back to the Lucide Bot icon if the key is unrecognized.
 */
export default function BotIcon({ iconKey, size = 24, className }: BotIconProps) {
  const IconComponent = iconKey ? ICON_MAP[iconKey] : undefined;
  const ResolvedIcon = IconComponent || Bot;

  return <ResolvedIcon size={size} className={className} />;
}
