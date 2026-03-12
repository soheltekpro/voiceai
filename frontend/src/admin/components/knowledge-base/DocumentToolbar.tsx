import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { Document } from '../../../api/knowledge-bases';

type DocumentToolbarProps = {
  document: Document | null;
  /** When true, show a download button (e.g. for blob URL of selected file). */
  canDownload?: boolean;
  onDownload?: () => void;
  onRefresh?: () => void;
  onDelete?: () => void;
  refreshing?: boolean;
  deleting?: boolean;
};

export function DocumentToolbar({
  document,
  canDownload = false,
  onDownload,
  onRefresh,
  onDelete,
  refreshing = false,
  deleting = false,
}: DocumentToolbarProps) {
  const status = document
    ? document.chunkCount > 0
      ? 'Completed'
      : 'Processing'
    : null;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-3">
        {document && (
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium',
              status === 'Completed'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            )}
          >
            {status}
          </span>
        )}
        {document && (
          <span className="truncate text-sm text-slate-700">{document.name}</span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {canDownload && onDownload && (
          <Button variant="ghost" size="sm" onClick={onDownload} className="text-slate-600 hover:text-slate-900">
            <Download className="mr-1.5 h-4 w-4" />
            Download
          </Button>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-slate-600 hover:text-slate-900"
          >
            <RefreshCw className={cn('mr-1.5 h-4 w-4', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        )}
        {document && onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={deleting}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
