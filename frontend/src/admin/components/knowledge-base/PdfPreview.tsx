import { useState, useCallback } from 'react';
import { FileText, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

type PdfPreviewProps = {
  /** Blob or object URL of the PDF to display (e.g. from file input). */
  fileUrl: string | null;
  /** Optional label when no URL (e.g. "Select a document or upload a PDF"). */
  emptyMessage?: string;
  className?: string;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;

export function PdfPreview({ fileUrl, emptyMessage = 'No PDF to preview', className }: PdfPreviewProps) {
  const [zoom, setZoom] = useState(1);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  }, []);
  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }, []);
  const resetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  if (!fileUrl) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-500',
          className
        )}
      >
        <FileText className="mb-3 h-14 w-14 text-slate-400" />
        <p className="text-sm">{emptyMessage}</p>
        <p className="mt-1 text-xs text-slate-600">Upload a PDF or select a file to preview</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-1 flex-col overflow-hidden', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-100/30 px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} className="h-8 w-8 p-0 text-slate-600">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[4rem] text-center text-xs text-slate-600">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} className="h-8 w-8 p-0 text-slate-600">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={resetZoom} className="h-8 px-2 text-xs text-slate-600">
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reset
          </Button>
        </div>
        <p className="text-xs text-slate-500">Scroll to navigate</p>
      </div>
      <div className="flex-1 overflow-auto bg-slate-200/30 p-4">
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
          className="min-h-full w-full"
        >
          <iframe
            src={fileUrl}
            title="PDF preview"
            className="h-[calc(100vh-220px)] min-h-[480px] w-full rounded border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
}
