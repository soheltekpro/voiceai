import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { DocumentToolbar } from './DocumentToolbar';
import { PdfPreview } from './PdfPreview';
import type { Document } from '../../../api/knowledge-bases';

type KnowledgeBaseViewerProps = {
  selectedKbName: string | null;
  documents: Document[];
  selectedDocument: Document | null;
  /** Blob URL for the currently chosen file (before or after upload). */
  pdfPreviewUrl: string | null;
  pasteText: string;
  url: string;
  pdfFile: File | null;
  onPasteTextChange: (v: string) => void;
  onUrlChange: (v: string) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearPdf: () => void;
  onUpload: () => void;
  onRefreshDocuments: () => void;
  onDeleteDocument: (docId: string) => void;
  uploading: boolean;
  refreshing?: boolean;
  deleting?: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
};

export function KnowledgeBaseViewer({
  selectedKbName,
  selectedDocument,
  pdfPreviewUrl,
  pasteText,
  url,
  pdfFile,
  onPasteTextChange,
  onUrlChange,
  onFileChange,
  onClearPdf,
  onUpload,
  onRefreshDocuments,
  onDeleteDocument,
  uploading,
  refreshing = false,
  deleting = false,
  fileInputRef,
}: KnowledgeBaseViewerProps) {
  const canUpload = !!(pdfFile || pasteText.trim() || url.trim());
  const showToolbar = !!selectedDocument || !!pdfPreviewUrl;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-900/30">
      {selectedKbName && (
        <Card className="mx-4 mt-4 shrink-0 border-slate-800">
          <CardHeader className="py-4">
            <CardTitle className="text-base text-white">Add to &quot;{selectedKbName}&quot;</CardTitle>
            <CardDescription>Upload a PDF, paste text, or add a URL. Then click Add to knowledge base.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <Tabs defaultValue="pdf" className="w-full">
              <TabsList className="grid w-full grid-cols-3 bg-slate-800">
                <TabsTrigger value="pdf">PDF</TabsTrigger>
                <TabsTrigger value="paste">Paste</TabsTrigger>
                <TabsTrigger value="url">URL</TabsTrigger>
              </TabsList>
              <TabsContent value="pdf" className="space-y-4 pt-4">
                <div>
                  <Label className="text-slate-400">Upload PDF</Label>
                  <input
                    ref={fileInputRef as React.RefObject<HTMLInputElement>}
                    type="file"
                    accept="application/pdf"
                    onChange={onFileChange}
                    className="mt-2 block w-full text-sm text-slate-400 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-slate-200"
                  />
                  {pdfFile && (
                    <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2">
                      <span className="text-sm text-slate-300">{pdfFile.name}</span>
                      <Button type="button" variant="ghost" size="sm" onClick={onClearPdf}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="paste" className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="paste-text" className="text-slate-400">Paste text</Label>
                  <textarea
                    id="paste-text"
                    value={pasteText}
                    onChange={(e) => onPasteTextChange(e.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                    placeholder="Paste or type content here..."
                  />
                </div>
              </TabsContent>
              <TabsContent value="url" className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="url-input" className="text-slate-400">URL</Label>
                  <Input
                    id="url-input"
                    type="url"
                    value={url}
                    onChange={(e) => onUrlChange(e.target.value)}
                    placeholder="https://example.com/page"
                    className="mt-2 bg-slate-950 border-slate-700 text-white"
                  />
                </div>
              </TabsContent>
            </Tabs>
            <Button disabled={!canUpload || uploading} onClick={onUpload} className="w-full">
              {uploading ? 'Uploading…' : 'Add to knowledge base'}
            </Button>
          </CardContent>
        </Card>
      )}

      {showToolbar && (
        <DocumentToolbar
          document={selectedDocument}
          canDownload={!!pdfPreviewUrl}
          onDownload={() => pdfPreviewUrl && window.open(pdfPreviewUrl)}
          onRefresh={onRefreshDocuments}
          onDelete={selectedDocument ? () => onDeleteDocument(selectedDocument.id) : undefined}
          refreshing={refreshing}
          deleting={deleting}
        />
      )}

      <div className="min-h-0 flex-1 p-4">
        <PdfPreview
          fileUrl={pdfPreviewUrl}
          emptyMessage={selectedKbName ? 'Select a file above or choose a document from the sidebar' : 'Select a knowledge base to add and preview documents'}
          className="h-full"
        />
      </div>
    </div>
  );
}
