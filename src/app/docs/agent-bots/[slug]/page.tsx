/**
 * Agent Bot Documentation Page
 *
 * Protected documentation page for agent bots.
 * Access rules:
 * - Admin: Full access to all agent docs
 * - Superuser: Access only if agent's categories overlap with user's categories
 */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, getUserId } from '@/lib/users';
import { getSuperUserWithAssignments, getAgentBotBySlug, checkSuperuserAgentBotAccess, getDefaultVersion } from '@/lib/db/compat';
import AgentBotDocsContent from './AgentBotDocsContent';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function AgentBotDocsPage({ params }: PageProps) {
  const { slug } = await params;

  // Check authentication
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Check user role
  const role = await getUserRole(user.email);
  if (role !== 'admin' && role !== 'superuser') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Access Denied
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            You do not have permission to view this documentation.
          </p>
        </div>
      </div>
    );
  }

  // Get the agent bot
  const agentBot = await getAgentBotBySlug(slug);
  if (!agentBot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Not Found
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            The requested agent bot documentation was not found.
          </p>
        </div>
      </div>
    );
  }

  // For superusers, check category-based access
  if (role === 'superuser') {
    const userId = await getUserId(user.email);
    if (!userId) {
      redirect('/login');
    }

    const superUserData = await getSuperUserWithAssignments(userId);
    const userCategoryIds = (superUserData?.assignedCategories || []).map(
      (c) => c.categoryId
    );

    const hasAccess = await checkSuperuserAgentBotAccess(agentBot.id, userCategoryIds);
    if (!hasAccess) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Access Denied
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              You do not have access to this agent bot&apos;s documentation.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              Contact your administrator if you need access.
            </p>
          </div>
        </div>
      );
    }
  }

  // Get the default version for displaying documentation
  const defaultVersion = await getDefaultVersion(agentBot.id);

  return (
    <AgentBotDocsContent
      agentBot={agentBot}
      defaultVersion={defaultVersion}
      baseUrl={process.env.NEXTAUTH_URL || 'http://localhost:3000'}
    />
  );
}
