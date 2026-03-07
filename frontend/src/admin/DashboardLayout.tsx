import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  BookOpen,
  Wrench,
  Phone,
  Megaphone,
  PhoneCall,
  Monitor,
  CreditCard,
  Activity,
  BarChart3,
  Phone as PhoneIcon,
  Cable,
  History,
  Radio,
  Settings,
  ChevronRight,
  Building2,
  Users,
  Key,
  Webhook,
  LogOut,
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
      { to: '/admin/tools', label: 'Tools', icon: Wrench },
      { to: '/admin/phonebooks', label: 'Phonebooks', icon: Phone },
      { to: '/admin/campaigns', label: 'Campaigns', icon: Megaphone },
    ],
  },
  {
    label: 'TEST',
    items: [
      { to: '/admin/web-call', label: 'Web Call', icon: PhoneCall },
      { to: '/admin/voice-calls', label: 'Voice Calls', icon: PhoneIcon },
    ],
  },
  {
    label: 'MONITOR',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: Activity },
      { to: '/admin/billing', label: 'Billing', icon: CreditCard },
      { to: '/admin/usage', label: 'Usage', icon: BarChart3 },
    ],
  },
  {
    label: 'WORKSPACE',
    items: [
      { to: '/admin/workspace', label: 'Workspace', icon: Building2 },
      { to: '/admin/team', label: 'Team', icon: Users },
      { to: '/admin/api-keys', label: 'API Keys', icon: Key },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { to: '/admin/sip-trunks', label: 'SIP Trunks', icon: Cable },
      { to: '/admin/phone-numbers', label: 'Phone Numbers', icon: Phone },
      { to: '/admin/outbound-calls', label: 'Outbound Calls', icon: PhoneIcon },
      { to: '/admin/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/admin/websocket', label: 'WebSocket', icon: Radio },
      { to: '/admin/calls', label: 'Call History', icon: History },
      { to: '/admin/monitoring', label: 'Live Events', icon: Monitor },
      { to: '/admin/live-events', label: 'Live Monitoring', icon: Radio },
      { to: '/admin/settings', label: 'Settings', icon: Settings },
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
            ? 'bg-slate-800 text-emerald-400'
            : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
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

  const handleLogout = () => {
    clearAuth();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-lg font-semibold text-white">Voice AI</h1>
          <p className="text-xs text-slate-500 mt-0.5">{workspace?.name ?? 'Admin'}</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {user && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-slate-800/60 text-xs text-slate-400">
              <p className="truncate">{user.email}</p>
              <p className="text-slate-500">{user.role}</p>
            </div>
          )}
          {navSections.map((section) => (
            <div key={section.label ?? 'main'}>
              {section.label && (
                <>
                  <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {section.label}
                  </p>
                </>
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
          <div className="pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            >
              <LogOut className="h-5 w-5 shrink-0" />
              Sign out
            </button>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
