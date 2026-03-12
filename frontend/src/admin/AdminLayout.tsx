import { NavLink, Outlet } from 'react-router-dom';

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `px-3 py-2 rounded-md text-sm font-medium transition ${
          isActive ? 'bg-slate-700 text-slate-50' : 'text-slate-700 hover:bg-slate-100'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">VoiceAI Admin</div>
            <div className="text-xs text-slate-600">Agents · Call history · Live monitoring</div>
          </div>
          <nav className="flex gap-2">
            <NavItem to="/admin/agents" label="Agents" />
            <NavItem to="/admin/calls" label="Call sessions" />
            <NavItem to="/admin/monitoring" label="Monitoring" />
            <NavItem to="/" label="Voice test" />
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

