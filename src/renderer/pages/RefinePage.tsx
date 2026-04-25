import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { Button, Toggle } from "../components/shared";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
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

const StatusLog = styled.pre`
  font-size: 11px;
  color: ${theme.colors.textSecondary};
  background: ${theme.colors.bg};
  padding: 10px 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  max-height: 120px;
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

  // Load generated images from run directory
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
    load();
    return () => { mounted = false; };
  }, [lastRun?.runDir]);

  const handleGenerate = useCallback(async () => {
    console.log("[RefinePage] handleGenerate called", { lastRun: lastRun?.runId, refineOptions, selectedVersion });
    if (!lastRun?.runId || !lastRun?.runDir) {
      setLog("No pipeline run found. Please run the pipeline first.");
      return;
    }

    setRunning(true);
    setPipelineStatus("running");
    setPipelineProgress(0);
    setPipelineStep("Starting refine...");
    setLog("");

    const commands: Array<"refine-pass" | "face-edit" | "detail-edit"> = [];
    if (refineOptions.faceEdit) commands.push("face-edit");
    // refine-pass requires regions_{k}.json, not yet available in the app

    console.log("[RefinePage] commands to run:", commands);

    if (commands.length === 0) {
      setLog("未选择精修选项。请启用脸部精修。");
      setRunning(false);
      return;
    }

    // Execute each refine command sequentially
    for (const cmd of commands) {
      setPipelineStep(`Running ${cmd}...`);
      setLog((prev) => prev + `\n[${cmd}] Starting...\n`);

      const extraArgs: string[] = [];
      if (cmd === "refine-pass") {
        extraArgs.push("--index", String(selectedVersion));
      }

      try {
        console.log("[RefinePage] calling refineRun:", { runId: lastRun.runId, command: cmd, extraArgs });
        const result = await window.electronAPI.script.refineRun({
          runId: lastRun.runId,
          command: cmd,
          extraArgs,
        });
        console.log("[RefinePage] refineRun result:", result);

        setLog((prev) => prev + result.output + "\n");
        if (!result.success) {
          setLog((prev) => prev + `[${cmd}] ERROR: ${result.error}\n`);
          setPipelineStatus("error");
          setPipelineOutput(result.output);
          setPipelineError(result.error || "");
          setRunning(false);
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setLog((prev) => prev + `[${cmd}] ERROR: ${message}\n`);
        setPipelineStatus("error");
        setPipelineError(message);
        setRunning(false);
        return;
      }
    }

    // Rescan for generated images after refine
    try {
      const files = await window.electronAPI.file.listDir(lastRun.runDir);
      const imageFiles = await Promise.all(
        files
          .filter((f) => f.endsWith(".png") && f.startsWith("draft_"))
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
    setRunning(false);
    navigate("/deliver");
  }, [lastRun, refineOptions, selectedVersion, navigate, setPipelineStatus, setPipelineProgress, setPipelineStep, setGeneratedImages, setPipelineOutput, setPipelineError]);

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>精细终稿</PageTitle>
        <PageDescription>
          从初版中选定满意构图，配置精细化参数后生成最终版本。
        </PageDescription>

        <TwoPanel>
          <SelectPanel>
            <PanelTitle>选择终稿构图</PanelTitle>
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
                      {selectedVersion === i ? "✓ v" : "v"}
                      {i + 1}
                    </VersionLabel>
                  )}
                </VersionCard>
              ))}
            </VersionCards>
          </SelectPanel>

          <OptionsPanel>
            <PanelTitle>精细化选项</PanelTitle>

            <OptionRow>
              <OptionLabel>
                <OptionTitle>脸部精修</OptionTitle>
                <OptionDesc>基于 face 参考图精修面部</OptionDesc>
              </OptionLabel>
              <Toggle
                $checked={refineOptions.faceEdit}
                onClick={() => setRefineOptions({ faceEdit: !refineOptions.faceEdit })}
              />
            </OptionRow>

            <OptionRow>
              <OptionLabel>
                <OptionTitle>输出分辨率</OptionTitle>
              </OptionLabel>
              <ResolutionSelect
                value={refineOptions.resolution}
                onChange={(e) => setRefineOptions({ resolution: e.target.value })}
              >
                <option value="4k">4K (3840×5120)</option>
                <option value="2k">2K (2560×3840)</option>
                <option value="hd">HD (1920×2560)</option>
              </ResolutionSelect>
            </OptionRow>

            {running && (
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
          返回
        </Button>
        <Button
          $variant="primary"
          $size="lg"
          disabled={running}
          onClick={handleGenerate}
        >
          {running ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {running ? "生成中..." : "生成精细终稿 →"}
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
