import { Link } from 'react-router-dom';
import { VoiceAgentPhase1 } from '../../components/VoiceAgentPhase1';

export function WebCallPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link
          to="/admin"
          className="text-sm text-slate-600 hover:text-slate-800"
        >
          ← Back to Dashboard
        </Link>
      </div>
      <VoiceAgentPhase1 />
    </div>
  );
}
