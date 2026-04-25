  import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { Download, Package, FileText, Image as ImageIcon, RotateCcw, AlertTriangle } from "lucide-react";
import { theme } from "../styles/theme";
import { Button } from "../components/shared";
import { useWorkflow, type LastRunMeta } from "../context/WorkflowContext";

interface ArtifactFile {
  label: string;
  sourcePath: string;
  fileName: string;
  icon: typeof ImageIcon;
}

const PageContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ScrollContent = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
`;

const PageTitle = styled.h1`
  font-size: 22px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 4px;
`;

const PageDescription = styled.p`
  font-size: 13px;
  color: ${theme.colors.textSecondary};
  margin-bottom: 28px;
`;

const Card = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
  margin-bottom: 20px;
`;

const MetaText = styled.p`
  font-size: 12px;
  color: ${theme.colors.textMuted};
  line-height: 1.7;
`;

const FileList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const FileItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
`;

const FileIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: ${theme.colors.cardBg};
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${theme.colors.textSecondary};
  flex-shrink: 0;
`;

const FileInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const FileName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.text};
`;

const FilePath = styled.div`
  font-size: 11px;
  color: ${theme.colors.textMuted};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const InlineButton = styled.button`
  background: transparent;
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.textSecondary};
  padding: 6px 12px;
  font-size: 12px;
  font-family: ${theme.fonts.family};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover {
    border-color: ${theme.colors.primary};
    color: ${theme.colors.primary};
  }
`;

const EmptyState = styled(Card)`
  color: ${theme.colors.textMuted};
  display: flex;
  align-items: center;
  gap: 10px;
`;

const ActionsBar = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 40px 24px;
  flex-shrink: 0;
`;

const buildArtifacts = async (runDir: string): Promise<ArtifactFile[]> => {
  return [
    { label: "Draft 2A Image", fileName: "draft_2a.png", sourcePath: await window.electronAPI.path.join(runDir, "draft_2a.png"), icon: ImageIcon },
    { label: "Logo Patch", fileName: "look_logo_patch.png", sourcePath: await window.electronAPI.path.join(runDir, "look_logo_patch.png"), icon: ImageIcon },
    { label: "Face Patch", fileName: "look_face_patch.png", sourcePath: await window.electronAPI.path.join(runDir, "look_face_patch.png"), icon: ImageIcon },
    { label: "Detail Patch", fileName: "look_detail_patch.png", sourcePath: await window.electronAPI.path.join(runDir, "look_detail_patch.png"), icon: ImageIcon },
    { label: "Approved Spec", fileName: "look_spec_approved.json", sourcePath: await window.electronAPI.path.join(runDir, "look_spec_approved.json"), icon: FileText },
    { label: "Input Manifest", fileName: "input_manifest.json", sourcePath: await window.electronAPI.path.join(runDir, "input_manifest.json"), icon: FileText },
  ];
};

export function DeliverPage() {
  const navigate = useNavigate();
  const { lastRun: workflowLastRun } = useWorkflow();
  const [lastRun, setLastRun] = useState<LastRunMeta | null>(null);
  const [files, setFiles] = useState<ArtifactFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        if (!workflowLastRun) {
          setLastRun(null);
          setFiles([]);
          return;
        }

        setLastRun(workflowLastRun);
        const candidates = await buildArtifacts(workflowLastRun.runDir);
        const checks = await Promise.all(
          candidates.map(async (file) => ({
            file,
            exists: await window.electronAPI.file.exists(file.sourcePath),
          })),
        );
        setFiles(checks.filter((item) => item.exists).map((item) => item.file));
      } catch {
        setLastRun(null);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [workflowLastRun]);

  const handleDownload = useCallback(async (file: ArtifactFile) => {
    setBusy(true);
    try {
      await window.electronAPI.file.saveCopy({
        sourcePath: file.sourcePath,
        fileName: file.fileName,
        defaultPath: file.fileName,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (files.length === 0) return;
    const folder = await window.electronAPI.file.saveFolder();
    if (!folder) return;

    setBusy(true);
    try {
      await Promise.all(
        files.map(async (file) =>
          window.electronAPI.file.copy({
            sourcePath: file.sourcePath,
            destinationPath: await window.electronAPI.path.join(folder, file.fileName),
          }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [files]);

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>Deliver Assets</PageTitle>
        <PageDescription>
          This page now reads the latest run metadata from local storage and exposes
          the real files found in the pipeline run directory.
        </PageDescription>

        {lastRun && (
          <Card>
            <MetaText>Run ID: {lastRun.runId}</MetaText>
            <MetaText>Run Directory: {lastRun.runDir}</MetaText>
            <MetaText>UI Output Folder: {lastRun.outputDir}</MetaText>
          </Card>
        )}

        {loading ? (
          <Card>
            <MetaText>Loading artifacts...</MetaText>
          </Card>
        ) : files.length === 0 ? (
          <EmptyState>
            <AlertTriangle size={16} color={theme.colors.warning} />
            No exported artifacts were found for the latest run. Run the pipeline first.
          </EmptyState>
        ) : (
          <Card>
            <FileList>
              {files.map((file) => (
                <FileItem key={file.sourcePath}>
                  <FileIcon>
                    <file.icon size={16} />
                  </FileIcon>
                  <FileInfo>
                    <FileName>{file.label}</FileName>
                    <FilePath>{file.sourcePath}</FilePath>
                  </FileInfo>
                  <InlineButton type="button" onClick={() => void handleDownload(file)} disabled={busy}>
                    <Download size={12} />
                    Download
                  </InlineButton>
                </FileItem>
              ))}
            </FileList>
          </Card>
        )}
      </ScrollContent>

      <ActionsBar>
        <Button $variant="secondary" onClick={() => navigate("/prepare")} disabled={busy}>
          <RotateCcw size={14} />
          New Task
        </Button>
        <Button $variant="primary" $size="lg" onClick={() => void handleDownloadAll()} disabled={busy || files.length === 0}>
          <Package size={14} />
          Download All
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
