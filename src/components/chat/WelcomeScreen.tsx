'use client';

import {
  MessageSquarePlus,
  MessageSquare,
  Upload,
  PanelRight,
  Brain,
  Settings,
  Shield,
  Mic,
  Link,
} from 'lucide-react';
import Button from '@/components/ui/Button';

interface WelcomeScreenProps {
  userRole: 'user' | 'superuser' | 'admin';
  brandingName: string;
  onNewThread?: () => void;
}

interface TopicCard {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export default function WelcomeScreen({
  userRole,
  brandingName,
  onNewThread,
}: WelcomeScreenProps) {
  // Base topics for all roles
  const baseTopics: TopicCard[] = [
    {
      icon: <MessageSquarePlus size={24} className="text-blue-500" />,
      title: 'Start a New Conversation',
      description: 'Click "+ New Thread" to begin. Select a category to focus your questions on specific policy documents.',
    },
    {
      icon: <MessageSquare size={24} className="text-green-500" />,
      title: 'Continue Existing Threads',
      description: 'Your previous conversations are saved in the left panel. Click any thread to resume where you left off.',
    },
    {
      icon: <Upload size={24} className="text-purple-500" />,
      title: 'Chat Features',
      description: 'Type questions, upload documents (PDF up to 5MB), use voice input, or paste web URLs for analysis.',
    },
    {
      icon: <PanelRight size={24} className="text-orange-500" />,
      title: 'Artifacts Panel',
      description: 'View uploaded files, AI-generated documents, and extracted content in the right panel.',
    },
    {
      icon: <Brain size={24} className="text-pink-500" />,
      title: 'Your Memory',
      description: 'The assistant remembers important facts about you across conversations. Access via "Your Memory" in the sidebar.',
    },
  ];

  // Additional topics for superuser
  const superuserTopics: TopicCard[] = [
    {
      icon: <Settings size={24} className="text-amber-500" />,
      title: 'Manage Your Categories',
      description: 'Access the Manage dashboard to upload documents, configure prompts, and manage user subscriptions.',
    },
  ];

  // Additional topics for admin
  const adminTopics: TopicCard[] = [
    {
      icon: <Shield size={24} className="text-red-500" />,
      title: 'Admin Dashboard',
      description: 'Full system control: manage all categories, users, skills, tools, and system settings.',
    },
  ];

  // Combine topics based on role
  let topics = [...baseTopics];
  if (userRole === 'superuser') {
    topics = [...topics, ...superuserTopics];
  } else if (userRole === 'admin') {
    topics = [...topics, ...adminTopics];
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
            Welcome to {brandingName}
          </h1>
          <p className="text-gray-600">
            Your AI assistant for policy documents and compliance
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
          <Button onClick={onNewThread} className="flex items-center gap-2">
            <MessageSquarePlus size={18} />
            Start New Thread
          </Button>
        </div>

        {/* Topic Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {topics.map((topic, index) => (
            <div
              key={index}
              className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 p-2 bg-gray-50 rounded-lg">
                  {topic.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium text-gray-900 mb-1">
                    {topic.title}
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">
                    {topic.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Additional Tips */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
            <Mic size={16} />
            Quick Tips
          </h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              Use the microphone button for voice input
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              Paste web URLs or YouTube links to extract content
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              The assistant can generate charts, documents, and search the web
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
