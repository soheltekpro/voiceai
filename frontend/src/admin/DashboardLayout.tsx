import { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  BookOpen,
  PhoneCall,
  Activity,
  History,
  ChevronRight,
  // Building2,
  // Users,
  Key,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getStoredWorkspace, getStoredUser, clearAuth } from '../api/auth';
import { cn } from '../lib/utils';

const navSections = [
  {
    label: null,
    items: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'BUILD',
    items: [
      { to: '/admin/agents', label: 'Agents', icon: Bot },
      { to: '/admin/knowledge-bases', label: 'Knowledge Bases', icon: BookOpen },
      // { to: '/admin/tools', label: 'Tools', icon: Wrench },
      // { to: '/admin/phonebooks', label: 'Phonebooks', icon: Phone },
      // { to: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    label: 'TEST',
    items: [
      { to: '/admin/web-call', label: 'Web Call', icon: PhoneCall },
      // { to: '/admin/voice-calls', label: 'Voice Calls', icon: PhoneIcon },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: Activity },
      // { to: '/admin/voice-analytics', label: 'Voice Analytics', icon: Radio },
      // { to: '/admin/billing', label: 'Billing', icon: CreditCard },
      // { to: '/admin/usage', label: 'Usage', icon: BarChart3 },
      // { to: '/admin/memory', label: 'Conversation memory', icon: Brain },
    ],
  },
  {
    label: 'WORKSPACE',
    items: [
      // { to: '/admin/workspace', label: 'Workspace', icon: Building2 },
      // { to: '/admin/team', label: 'Team', icon: Users },
      { to: '/admin/api-keys', label: 'API Keys', icon: Key },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      // { to: '/admin/sip-trunks', label: 'SIP Trunks', icon: Cable },
      // { to: '/admin/phone-numbers', label: 'Phone Numbers', icon: Phone },
      // { to: '/admin/outbound-calls', label: 'Outbound Calls', icon: PhoneIcon },
      // { to: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
      // { to: '/admin/websocket', label: 'WebSocket', icon: Radio },
      { to: '/admin/calls', label: 'Call History', icon: History },
      // { to: '/admin/monitoring', label: 'Live Events', icon: Monitor },
      // { to: '/admin/live-events', label: 'Live Monitoring', icon: Radio },
      // { to: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function NavItem({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <NavLink
      to={to}
      end={to === '/admin'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-slate-200 text-emerald-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-4 w-4 opacity-50" />
    </NavLink>
  );
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const workspace = getStoredWorkspace();
  const user = getStoredUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <aside className="h-full w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white flex flex-col">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between lg:block">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Voice AI</h1>
          <p className="text-xs text-slate-500 mt-0.5">{workspace?.name ?? 'Admin'}</p>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Close menu"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <nav className="p-4 space-y-6 flex-1 overflow-y-auto">
        {user && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-slate-100 text-xs text-slate-600">
            <p className="truncate">{user.email}</p>
            <p className="text-slate-500">{user.role}</p>
          </div>
        )}
        {navSections.map((section) => (
          <div key={section.label ?? 'main'}>
            {section.label && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {section.label}
              </p>
            )}
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavItem to={item.to} label={item.label} icon={item.icon} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="pt-4 border-t border-slate-200">
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sign out
          </button>
        </div>
      </nav>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      {/* Mobile overlay */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Close menu"
        onClick={() => setSidebarOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setSidebarOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden',
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      />

      {/* Sidebar: drawer on mobile, static on lg+ */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 ease-out lg:relative lg:translate-x-0 lg:flex',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebar}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header */}
        <header className="lg:hidden shrink-0 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <h1 className="text-base font-semibold text-slate-900 truncate">Voice AI</h1>
        </header>

        <main className="flex-1 min-h-0 overflow-auto">
          <div className="p-4 sm:p-6 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
