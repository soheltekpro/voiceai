import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from './DashboardLayout';
import { DashboardPage } from './pages/DashboardPage';
import { AgentsPageNew } from './pages/AgentsPageNew';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { KnowledgeBasesPage } from './pages/KnowledgeBasesPage';
import { ToolsPage } from './pages/ToolsPage';
import { WebCallPage } from './pages/WebCallPage';
import { CallHistoryPage } from './pages/CallHistoryPage';
import { CallDetailPage } from './pages/CallDetailPage';
import { CallSessionsPage } from './pages/CallSessionsPage';
import { CallSessionDetailPage } from './pages/CallSessionDetailPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { LiveEventsPage } from './pages/LiveEventsPage';
import { SipTrunksPage } from './pages/SipTrunksPage';
import { PhoneNumbersPage } from './pages/PhoneNumbersPage';
import { OutboundCallsPage } from './pages/OutboundCallsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { TeamPage } from './pages/TeamPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { BillingPage } from './pages/BillingPage';
import { UsagePage } from './pages/UsagePage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { WebhooksPage } from './pages/WebhooksPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

export function AdminApp() {
  return (
    <Routes>
      <Route path="/admin" element={<DashboardLayout />}>
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
        <Route path="workspace" element={<WorkspacePage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="api-keys" element={<ApiKeysPage />} />
        <Route path="settings" element={<PlaceholderPage title="Settings" description="Platform settings." />} />
      </Route>
      <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
