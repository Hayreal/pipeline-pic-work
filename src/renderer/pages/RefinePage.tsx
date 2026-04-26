import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { Button, Toggle } from "../components/shared";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { useWorkflow } from "../context/WorkflowContext";

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

const TwoPanel = styled.div`
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 24px;
`;

const SelectPanel = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
`;

const PanelTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 16px;
`;

const VersionCards = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
`;

const VersionCard = styled.div<{ $selected: boolean }>`
  aspect-ratio: 3 / 4;
  background: ${theme.colors.versionCardBg};
  border: 2px solid
    ${({ $selected }) =>
      $selected ? theme.colors.versionCardSelected : theme.colors.versionCardBorder};
  border-radius: ${theme.sizes.borderRadiusSm};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  overflow: hidden;

  &:hover {
    border-color: ${theme.colors.versionCardSelected};
  }
`;

const Thumbnail = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: calc(${theme.sizes.borderRadiusSm} - 2px);
`;

const VersionLabel = styled.span<{ $selected: boolean }>`
  font-size: 14px;
  color: ${({ $selected }) =>
    $selected ? theme.colors.versionCardSelected : theme.colors.textMuted};
  font-weight: 600;
`;

const CheckIcon = styled.div`
  position: absolute;
  top: 8px;
  left: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: ${theme.colors.versionCardSelected};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const OptionsPanel = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const OptionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const OptionLabel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const OptionTitle = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.text};
`;

const OptionDesc = styled.span`
  font-size: 11px;
  color: ${theme.colors.textMuted};
`;

const ResolutionSelect = styled.select`
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.text};
  padding: 6px 10px;
  font-size: 12px;
  font-family: ${theme.fonts.family};
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: ${theme.colors.primary};
  }
`;

const NoticeCard = styled.div<{ $tone?: "info" | "warning" }>`
  border-radius: ${theme.sizes.borderRadiusSm};
  padding: 12px 14px;
  background: ${({ $tone = "info" }) =>
    $tone === "warning" ? "rgba(255, 184, 77, 0.08)" : theme.colors.bg};
  border: 1px solid
    ${({ $tone = "info" }) =>
      $tone === "warning" ? "rgba(255, 184, 77, 0.24)" : theme.colors.border};
  color: ${theme.colors.textSecondary};
  font-size: 12px;
  line-height: 1.6;
`;

const NoticeTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  color: ${theme.colors.text};
  font-weight: 600;
`;

const StatusLog = styled.pre`
  font-size: 11px;
  color: ${theme.colors.textSecondary};
  background: ${theme.colors.bg};
  padding: 10px 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: "Consolas", "Monaco", monospace;
`;

const ActionsBar = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 40px 24px;
  flex-shrink: 0;
`;

type ManifestRoles = Record<string, unknown>;

function hasManifestFaceRole(raw: unknown): boolean {
  const roles = (raw as { roles?: ManifestRoles } | null)?.roles;
  if (!roles || typeof roles !== "object") return false;
  const face = roles.face;
  if (!face || typeof face !== "object") return false;

  const candidate = face as { path?: unknown; paths?: unknown };
  if (typeof candidate.path === "string" && candidate.path.trim()) return true;
  if (Array.isArray(candidate.paths) && candidate.paths.length > 0) return true;
  return false;
}

export function RefinePage() {
  const navigate = useNavigate();
  const {
    lastRun,
    refineOptions,
    setRefineOptions,
    setPipelineStatus,
    setPipelineProgress,
    pipelineStep,
    setPipelineStep,
    setGeneratedImages,
    setPipelineOutput,
    setPipelineError,
  } = useWorkflow();

  const [selectedVersion, setSelectedVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [hasFaceReference, setHasFaceReference] = useState(false);
  const [manifestChecked, setManifestChecked] = useState(false);

  useEffect(() => {
    if (!lastRun?.runDir) return;
    let mounted = true;
    const load = async () => {
      try {
        const files = await window.electronAPI.file.listDir(lastRun.runDir);
        if (!mounted) return;
        const drafts = files.filter((f) => f.endsWith(".png") && f.startsWith("draft_"));
        const urls: string[] = [];
        for (const f of drafts) {
          const fullPath = await window.electronAPI.path.join(lastRun.runDir, f);
          const dataUrl = await window.electronAPI.file.readAsDataURL(fullPath);
          if (dataUrl) urls.push(dataUrl);
        }
        if (mounted) setImageUrls(urls);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [lastRun?.runDir]);

  useEffect(() => {
    if (!lastRun?.runDir) {
      setHasFaceReference(false);
      setManifestChecked(false);
      return;
    }

    let mounted = true;
    const inspectManifest = async () => {
      try {
        const manifestPath = await window.electronAPI.path.join(lastRun.runDir, "input_manifest.json");
        const manifest = await window.electronAPI.file.readJson(manifestPath);
        if (mounted) {
          setHasFaceReference(hasManifestFaceRole(manifest));
          setManifestChecked(true);
        }
      } catch {
        if (mounted) {
          setHasFaceReference(false);
          setManifestChecked(true);
        }
      }
    };

    void inspectManifest();
    return () => {
      mounted = false;
    };
  }, [lastRun?.runDir]);

  const hasSelectedAction = refineOptions.faceEdit;
  const blockingReason = !lastRun?.runId || !lastRun?.runDir
    ? "No previous pipeline run was found. Run draft generation first."
    : !hasSelectedAction
      ? "No refine action is enabled. Turn on Face Refine before starting."
      : refineOptions.faceEdit && manifestChecked && !hasFaceReference
        ? "Face refine requires at least one uploaded image with role `face`. Go back to Prepare Materials and add it first."
        : "";
  const canRun = !running && blockingReason === "";

  const handleGenerate = useCallback(async () => {
    if (blockingReason) {
      setLog(blockingReason);
      setPipelineStatus("idle");
      setPipelineError(blockingReason);
      return;
    }

    if (!lastRun?.runId || !lastRun?.runDir) {
      setLog("No pipeline run found. Please run the pipeline first.");
      return;
    }

    setRunning(true);
    setPipelineStatus("running");
    setPipelineProgress(0);
    setPipelineStep("Starting refine...");
    setPipelineOutput("");
    setPipelineError("");
    setLog("");

    const commands: Array<"face-edit"> = [];
    if (refineOptions.faceEdit) commands.push("face-edit");

    if (commands.length === 0) {
      setLog("No refine action is currently executable.");
      setPipelineStatus("idle");
      setRunning(false);
      return;
    }

    for (const cmd of commands) {
      setPipelineStep(`Running ${cmd}...`);
      setLog((prev) => `${prev}\n[${cmd}] Starting...\n`);

      try {
        const result = await window.electronAPI.script.refineRun({
          runId: lastRun.runId,
          command: cmd,
          extraArgs: [],
        });

        setLog((prev) => `${prev}${result.output || ""}\n`);
        if (!result.success) {
          setLog((prev) => `${prev}[${cmd}] ERROR: ${result.error}\n`);
          setPipelineStatus("error");
          setPipelineOutput(result.output);
          setPipelineError(result.error || "");
          setRunning(false);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setLog((prev) => `${prev}[${cmd}] ERROR: ${message}\n`);
        setPipelineStatus("error");
        setPipelineError(message);
        setRunning(false);
        return;
      }
    }

    try {
      const files = await window.electronAPI.file.listDir(lastRun.runDir);
      const imageFiles = await Promise.all(
        files
          .filter((f) => f.endsWith(".png") && (f.startsWith("draft_") || f.startsWith("look_")))
          .map(async (f) => ({
            path: await window.electronAPI.path.join(lastRun.runDir, f),
            label: f,
          })),
      );
      if (imageFiles.length > 0) {
        setGeneratedImages(imageFiles);
      }
    } catch {
      // ignore
    }

    setPipelineStatus("success");
    setPipelineProgress(100);
    setPipelineStep("Refine complete");
    setPipelineError("");
    setRunning(false);
    navigate("/deliver");
  }, [
    blockingReason,
    lastRun,
    navigate,
    refineOptions.faceEdit,
    setGeneratedImages,
    setPipelineError,
    setPipelineOutput,
    setPipelineProgress,
    setPipelineStatus,
    setPipelineStep,
  ]);

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>Refine Final Output</PageTitle>
        <PageDescription>
          Select a draft version, then run the refine step that is currently supported by the desktop app.
        </PageDescription>

        <TwoPanel>
          <SelectPanel>
            <PanelTitle>Select Draft Version</PanelTitle>
            <VersionCards>
              {[0, 1, 2].map((i) => (
                <VersionCard
                  key={i}
                  $selected={selectedVersion === i}
                  onClick={() => setSelectedVersion(i)}
                >
                  {selectedVersion === i && (
                    <CheckIcon>
                      <Check size={12} color="#fff" />
                    </CheckIcon>
                  )}
                  {imageUrls[i] ? (
                    <Thumbnail src={imageUrls[i]} alt={`Version ${i + 1}`} />
                  ) : (
                    <VersionLabel $selected={selectedVersion === i}>
                      v{i + 1}
                    </VersionLabel>
                  )}
                </VersionCard>
              ))}
            </VersionCards>
          </SelectPanel>

          <OptionsPanel>
            <PanelTitle>Refine Options</PanelTitle>

            <NoticeCard>
              <NoticeTitle>Available in desktop app</NoticeTitle>
              <div>`face-edit` is available now.</div>
              <div>`refine-pass` is not wired yet because it needs a manual `regions_k.json` file.</div>
              <div>`detail-edit` is not wired yet because it needs explicit detail reference images and edit notes.</div>
            </NoticeCard>

            <OptionRow>
              <OptionLabel>
                <OptionTitle>Face Refine</OptionTitle>
                <OptionDesc>Requires at least one uploaded image with role `face`.</OptionDesc>
              </OptionLabel>
              <Toggle
                $checked={refineOptions.faceEdit}
                onClick={() => setRefineOptions({ faceEdit: !refineOptions.faceEdit })}
              />
            </OptionRow>

            <OptionRow>
              <OptionLabel>
                <OptionTitle>Output Resolution</OptionTitle>
                <OptionDesc>This option is stored in UI state only for now.</OptionDesc>
              </OptionLabel>
              <ResolutionSelect
                value={refineOptions.resolution}
                onChange={(e) => setRefineOptions({ resolution: e.target.value })}
              >
                <option value="4k">4K (3840x5120)</option>
                <option value="2k">2K (2560x3840)</option>
                <option value="hd">HD (1920x2560)</option>
              </ResolutionSelect>
            </OptionRow>

            {blockingReason && (
              <NoticeCard $tone="warning">
                <NoticeTitle>
                  <AlertTriangle size={14} />
                  Cannot start yet
                </NoticeTitle>
                <div>{blockingReason}</div>
              </NoticeCard>
            )}

            {(running || log) && (
              <StatusLog>
                {pipelineStep}
                {"\n"}
                {log}
              </StatusLog>
            )}
          </OptionsPanel>
        </TwoPanel>
      </ScrollContent>

      <ActionsBar>
        <Button $variant="secondary" onClick={() => navigate("/generate")}>
          <ArrowLeft size={14} />
          Back
        </Button>
        <Button
          $variant="primary"
          $size="lg"
          disabled={!canRun}
          onClick={handleGenerate}
        >
          {running ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {running ? "Running..." : "Generate Refined Output"}
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
