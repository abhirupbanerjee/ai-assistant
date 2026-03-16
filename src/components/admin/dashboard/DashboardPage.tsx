'use client';

import DashboardOverview from './DashboardOverview';
import UserStatistics from './UserStatistics';
import DocumentStatistics from './DocumentStatistics';
import QueryStatistics from './QueryStatistics';
import SystemHealth from './SystemHealth';
import InfrastructureStatus from './InfrastructureStatus';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <DashboardOverview />
      <UserStatistics />
      <DocumentStatistics />
      <QueryStatistics />
      <SystemHealth />
      <InfrastructureStatus />
    </div>
  );
}
