import { Search, Plus, BookOpen, FileText, Trash2 } from 'lucide-react';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { KnowledgeBase, Document } from '../../../api/knowledge-bases';

type KnowledgeBaseSidebarProps = {
  knowledgeBases: KnowledgeBase[];
  selectedKbId: string | null;
  documents: Document[];
  selectedDocumentId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectKb: (id: string | null) => void;
  onSelectDocument: (id: string | null) => void;
  onCreateKb: () => void;
  onDeleteKb?: (id: string) => void | Promise<void>;
  newKbName: string;
  onNewKbNameChange: (name: string) => void;
  creating: boolean;
  deletingKbId?: string | null;
};

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export function KnowledgeBaseSidebar({
  knowledgeBases,
  selectedKbId,
  documents,
  selectedDocumentId,
  searchQuery,
  onSearchChange,
  onSelectKb,
  onSelectDocument,
  onCreateKb,
  onDeleteKb,
  newKbName,
  onNewKbNameChange,
  creating,
  deletingKbId,
}: KnowledgeBaseSidebarProps) {
  const filteredKbs = searchQuery.trim()
    ? knowledgeBases.filter(
        (kb) =>
          kb.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : knowledgeBases;

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="border-b border-slate-800 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Search knowledge bases..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500"
          />
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="New KB name"
            value={newKbName}
            onChange={(e) => onNewKbNameChange(e.target.value)}
            className="flex-1 bg-slate-900 border-slate-700 text-white placeholder:text-slate-500 text-sm"
          />
          <Button size="sm" onClick={onCreateKb} disabled={creating || !newKbName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
            Knowledge bases
          </p>
          <ul className="space-y-0.5">
            {filteredKbs.length === 0 ? (
              <li className="rounded-lg px-3 py-4 text-center text-sm text-slate-500">
                {knowledgeBases.length === 0 ? 'Create a knowledge base above' : 'No matches'}
              </li>
            ) : (
              filteredKbs.map((kb) => (
                <li key={kb.id}>
                  <div
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 transition-colors',
                      selectedKbId === kb.id
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectKb(kb.id);
                        onSelectDocument(null);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <BookOpen className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{kb.name}</p>
                        <p className="text-xs text-slate-500">{formatDate(kb.createdAt)}</p>
                      </div>
                    </button>
                    {onDeleteKb && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('Are you sure you want to delete this knowledge base?')) {
                            onDeleteKb(kb.id);
                          }
                        }}
                        disabled={deletingKbId === kb.id}
                        className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-slate-700/80 hover:text-red-400 disabled:opacity-50"
                        title="Delete knowledge base"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>

        {selectedKbId && (
          <div className="border-t border-slate-800 p-2">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              Documents
            </p>
            <ul className="space-y-0.5">
              {documents.length === 0 ? (
                <li className="rounded-lg px-3 py-4 text-center text-sm text-slate-500">
                  No documents yet
                </li>
              ) : (
                documents.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => onSelectDocument(doc.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                        selectedDocumentId === doc.id
                          ? 'bg-slate-700/80 text-white'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{doc.name}</p>
                        <p className="text-xs text-slate-500">
                          {doc.sourceType} · {doc.chunkCount} chunks
                        </p>
                      </div>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
