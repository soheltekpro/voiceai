export default function App() {
  return <AppRouter />;
}

import { Route, Routes, Navigate } from 'react-router-dom';
import { getToken } from './api/auth';
import { AdminGate } from './admin/AdminGate';
import { DashboardLayout } from './admin/DashboardLayout';
import { LoginPage } from './admin/pages/LoginPage';
import { RegisterPage } from './admin/pages/RegisterPage';
import { DashboardPage } from './admin/pages/DashboardPage';
import { AgentsPageNew } from './admin/pages/AgentsPageNew';
import { AgentDetailPage } from './admin/pages/AgentDetailPage';
import { KnowledgeBasesPage } from './admin/pages/KnowledgeBasesPage';
import { ToolsPage } from './admin/pages/ToolsPage';
import { WebCallPage } from './admin/pages/WebCallPage';
import { CallHistoryPage } from './admin/pages/CallHistoryPage';
import { CallDetailPage } from './admin/pages/CallDetailPage';
import { CallSessionsPage } from './admin/pages/CallSessionsPage';
import { CallSessionDetailPage } from './admin/pages/CallSessionDetailPage';
import { MonitoringPage } from './admin/pages/MonitoringPage';
import { LiveEventsPage } from './admin/pages/LiveEventsPage';
import { SipTrunksPage } from './admin/pages/SipTrunksPage';
import { PhoneNumbersPage } from './admin/pages/PhoneNumbersPage';
import { OutboundCallsPage } from './admin/pages/OutboundCallsPage';
import { WorkspacePage } from './admin/pages/WorkspacePage';
import { TeamPage } from './admin/pages/TeamPage';
import { ApiKeysPage } from './admin/pages/ApiKeysPage';
import { BillingPage } from './admin/pages/BillingPage';
import { UsagePage } from './admin/pages/UsagePage';
import { AnalyticsPage } from './admin/pages/AnalyticsPage';
import { WebhooksPage } from './admin/pages/WebhooksPage';
import { OperatorCallPage } from './admin/pages/OperatorCallPage';
import { PlaceholderPage } from './admin/pages/PlaceholderPage';

/** Root path: if logged in go to admin dashboard (home), else to login. */
function RootRedirect() {
  const token = getToken();
  return <Navigate to={token ? '/admin' : '/login'} replace />;
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/admin" element={<AdminGate />}>
        <Route element={<DashboardLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="agents" element={<AgentsPageNew />} />
          <Route path="agents/:id" element={<AgentDetailPage />} />
          <Route path="knowledge-bases" element={<KnowledgeBasesPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="phonebooks" element={<PlaceholderPage title="Phonebooks" description="Manage phonebooks." />} />
          <Route path="campaigns" element={<PlaceholderPage title="Campaigns" description="Manage campaigns." />} />
          <Route path="web-call" element={<WebCallPage />} />
          <Route path="voice-calls" element={<PlaceholderPage title="Voice Calls" description="Test voice calls." />} />
          <Route path="billing" element={<BillingPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="webhooks" element={<WebhooksPage />} />
          <Route path="sip-trunks" element={<SipTrunksPage />} />
          <Route path="phone-numbers" element={<PhoneNumbersPage />} />
          <Route path="outbound-calls" element={<OutboundCallsPage />} />
          <Route path="websocket" element={<PlaceholderPage title="WebSocket" description="WebSocket configuration." />} />
          <Route path="calls" element={<CallHistoryPage />} />
          <Route path="calls/:id" element={<CallDetailPage />} />
          <Route path="call-sessions" element={<CallSessionsPage />} />
          <Route path="call-sessions/:id" element={<CallSessionDetailPage />} />
          <Route path="monitoring" element={<MonitoringPage />} />
          <Route path="live-events" element={<LiveEventsPage />} />
          <Route path="operator-call" element={<OperatorCallPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" description="Platform settings." />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
