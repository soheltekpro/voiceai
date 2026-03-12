import { useCallback, useEffect, useState, useRef } from 'react';
import {
  fetchKnowledgeBases,
  createKnowledgeBase,
  uploadToKnowledgeBase,
  uploadPdfToKnowledgeBase,
  fetchDocuments,
  deleteDocument,
  deleteKnowledgeBase,
} from '../../api/knowledge-bases';
import type { KnowledgeBase, Document } from '../../api/knowledge-bases';
import { KnowledgeBaseSidebar } from '../components/knowledge-base/KnowledgeBaseSidebar';
import { KnowledgeBaseViewer } from '../components/knowledge-base/KnowledgeBaseViewer';

export function KnowledgeBasesPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [url, setUrl] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [newKbName, setNewKbName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingKbId, setDeletingKbId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadKbs = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchKnowledgeBases();
      setKnowledgeBases(res.items);
      if (res.items.length && !selectedKbId) setSelectedKbId(res.items[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load knowledge bases');
    }
  }, [selectedKbId]);

  const loadDocuments = useCallback(async () => {
    if (!selectedKbId) return;
    setError(null);
    try {
      const res = await fetchDocuments(selectedKbId);
      setDocuments(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    }
  }, [selectedKbId]);

  useEffect(() => {
    void loadKbs();
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments, selectedKbId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Please select a PDF file.');
      return;
    }
    setPdfFile(file);
    const prev = pdfPreviewUrl;
    if (prev) URL.revokeObjectURL(prev);
    setPdfPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const clearPdf = useCallback(() => {
    setPdfFile(null);
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [pdfPreviewUrl]);

  const handleCreateKb = async () => {
    if (!newKbName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const kb = await createKnowledgeBase({ name: newKbName.trim() });
      setKnowledgeBases((prev) => [kb, ...prev]);
      setSelectedKbId(kb.id);
      setNewKbName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create knowledge base');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedKbId) {
      setError('Select or create a knowledge base first.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      if (pdfFile) {
        await uploadPdfToKnowledgeBase(selectedKbId, pdfFile);
        clearPdf();
      } else if (pasteText.trim()) {
        await uploadToKnowledgeBase(selectedKbId, {
          sourceType: 'text',
          text: pasteText.trim(),
          name: 'Pasted text',
        });
        setPasteText('');
      } else if (url.trim()) {
        await uploadToKnowledgeBase(selectedKbId, {
          sourceType: 'url',
          url: url.trim(),
          name: url.trim(),
        });
        setUrl('');
      } else {
        setError('Add a PDF, text, or URL to upload.');
        setUploading(false);
        return;
      }
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRefreshDocuments = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDocuments();
    } finally {
      setRefreshing(false);
    }
  }, [loadDocuments]);

  const handleDeleteDocument = async (docId: string) => {
    setDeleting(true);
    setError(null);
    try {
      await deleteDocument(docId);
      if (selectedDocumentId === docId) setSelectedDocumentId(null);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteKb = async (id: string) => {
    setDeletingKbId(id);
    setError(null);
    try {
      await deleteKnowledgeBase(id);
      const res = await fetchKnowledgeBases();
      setKnowledgeBases(res.items);
      setSelectedDocumentId(null);
      if (selectedKbId === id) {
        setSelectedKbId(res.items[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete knowledge base');
    } finally {
      setDeletingKbId(null);
    }
  };

  const selectedKb = knowledgeBases.find((kb) => kb.id === selectedKbId);
  const selectedDocument = documents.find((d) => d.id === selectedDocumentId) ?? null;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col">
      <div className="shrink-0 px-0 py-4 sm:px-4 md:px-6">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Knowledge Bases</h1>
        <p className="mt-1 text-xs text-slate-600 sm:text-sm">
          Add context for your agents via PDF, text, or URL. Link a KB to an agent for RAG.
        </p>
      </div>

      {error && (
        <div className="mb-2 rounded-lg border border-red-400/50 bg-red-50 px-4 py-3 text-sm text-red-800 sm:mx-0">
          {error}
        </div>
      )}

      <div className="flex min-h-[400px] min-w-0 flex-1 flex-col lg:flex-row">
        <KnowledgeBaseSidebar
          knowledgeBases={knowledgeBases}
          selectedKbId={selectedKbId}
          documents={documents}
          selectedDocumentId={selectedDocumentId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelectKb={setSelectedKbId}
          onSelectDocument={setSelectedDocumentId}
          onCreateKb={handleCreateKb}
          onDeleteKb={handleDeleteKb}
          newKbName={newKbName}
          onNewKbNameChange={setNewKbName}
          creating={loading}
          deletingKbId={deletingKbId}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <KnowledgeBaseViewer
            selectedKbName={selectedKb?.name ?? null}
            documents={documents}
            selectedDocument={selectedDocument}
            pdfPreviewUrl={pdfPreviewUrl}
            pasteText={pasteText}
            url={url}
            pdfFile={pdfFile}
            onPasteTextChange={setPasteText}
            onUrlChange={setUrl}
            onFileChange={handleFileChange}
            onClearPdf={clearPdf}
            onUpload={handleUpload}
            onRefreshDocuments={handleRefreshDocuments}
            onDeleteDocument={handleDeleteDocument}
            uploading={uploading}
            refreshing={refreshing}
            deleting={deleting}
            fileInputRef={fileInputRef}
          />
        </main>
      </div>
    </div>
  );
}
