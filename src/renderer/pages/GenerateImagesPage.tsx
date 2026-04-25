import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { theme } from "../styles/theme";
import { Button } from "../components/shared";
import { ArrowLeft, Check, AlertTriangle } from "lucide-react";
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

const ProgressSection = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
  margin-bottom: 24px;
`;

const ProgressHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const ProgressTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
`;

const ProgressCount = styled.span`
  font-size: 13px;
  color: ${theme.colors.textSecondary};
`;

const ProgressBar = styled.div`
  height: 4px;
  background: ${theme.colors.progressBg};
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 10px;
`;

const ProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${({ $progress }) => Math.max(0, $progress)}%;
  background: ${theme.colors.progressFill};
  border-radius: 2px;
  transition: width 0.5s ease;
`;

const ProgressMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
`;

const StatusDot = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${theme.colors.completedText};

  &::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${theme.colors.completedText};
  }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const Spinner = styled.div`
  width: 16px;
  height: 16px;
  border: 2px solid ${theme.colors.border};
  border-top-color: ${theme.colors.primary};
  border-radius: 50%;
  animation: ${pulse} 1.5s ease-in-out infinite;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
`;

const VersionCard = styled.div`
  aspect-ratio: 3 / 4;
  background: ${theme.colors.versionCardBg};
  border: 1px solid ${theme.colors.versionCardBorder};
  border-radius: ${theme.sizes.borderRadius};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  position: relative;
  transition: all 0.15s;
`;

const VersionCardCompleted = styled(VersionCard)`
  border-color: ${theme.colors.completedBg};
  background: ${theme.colors.completedBg};
`;

const VersionLabel = styled.span`
  font-size: 14px;
  color: ${theme.colors.textMuted};
`;

const CompletedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  position: absolute;
  bottom: 10px;
  left: 10px;
  background: ${theme.colors.completedText};
  color: ${theme.colors.bg};
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
`;

const WaitingLabel = styled.span`
  font-size: 12px;
  color: ${theme.colors.textMuted};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Thumbnail = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: ${theme.sizes.borderRadius};
`;

const CurrentStepLabel = styled.p`
  font-size: 12px;
  color: ${theme.colors.textMuted};
  margin-top: 8px;
  font-style: italic;
`;

const ErrorCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
  margin-bottom: 24px;
  border: 1px solid ${theme.colors.danger};
`;

const ErrorTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.danger};
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const ErrorLog = styled.pre`
  font-size: 11px;
  color: ${theme.colors.textSecondary};
  background: ${theme.colors.bg};
  padding: 10px 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  max-height: 200px;
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

export function GenerateImagesPage() {
  const navigate = useNavigate();
  const { lastRun, pipelineProgress, pipelineStep, pipelineStatus, generatedImages, setGeneratedImages, pipelineOutput, pipelineError } = useWorkflow();

  const [liveProgress, setLiveProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [scanDone, setScanDone] = useState(false);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  const total = 6;
  const progress = pipelineStatus === "success" ? 100 : liveProgress;
  const completedCount = Math.floor((progress / 100) * total);
  const isDone = pipelineStatus === "success" && completedCount >= total;

  useEffect(() => {
    // Map pipeline progress to completed image count
    if (pipelineStatus === "running") {
      setLiveProgress(pipelineProgress);
    }
  }, [pipelineProgress, pipelineStatus]);

  useEffect(() => {
    setCurrentStep(pipelineStep);
  }, [pipelineStep]);

  useEffect(() => {
    // Scan run directory for generated images
    if (!lastRun?.runId || !lastRun?.runDir) {
      console.log("[GenerateImagesPage] no lastRun available");
      return;
    }

    let mounted = true;
    const scanForImages = async () => {
      try {
        console.log("[GenerateImagesPage] scanning:", lastRun.runDir);
        const files = await window.electronAPI.file.listDir(lastRun.runDir);
        console.log("[GenerateImagesPage] files found:", files);
        if (!mounted) return;

        const draftFiles = files
          .filter((f) => f.endsWith(".png") && f.startsWith("draft_"));

        const result: Array<{ path: string; label: string }> = [];
        for (const f of draftFiles) {
          const fullPath = await window.electronAPI.path.join(lastRun.runDir, f);
          const dataUrl = await window.electronAPI.file.readAsDataURL(fullPath);
          console.log("[GenerateImagesPage] loaded image:", f, dataUrl ? "OK" : "EMPTY");
          if (dataUrl) {
            result.push({ path: dataUrl, label: f });
          }
        }

        console.log("[GenerateImagesPage] draft images:", result.length);
        if (result.length > 0) {
          setGeneratedImages(result);
          // Build map of index -> dataUrl for display
          if (mounted) {
            const urlMap: Record<number, string> = {};
            result.forEach((img, i) => { urlMap[i] = img.path; });
            setImageUrls(urlMap);
          }
        }
      } catch (e) {
        console.error("[GenerateImagesPage] scan error:", e);
      } finally {
        if (mounted) setScanDone(true);
      }
    };

    scanForImages();

    // Set up a polling interval to re-scan while pipeline is running
    if (pipelineStatus === "running") {
      const interval = setInterval(scanForImages, 2000);
      return () => {
        mounted = false;
        clearInterval(interval);
      };
    }
    return () => {
      mounted = false;
    };
  }, [lastRun?.runId, lastRun?.runDir, pipelineStatus, setGeneratedImages]);

  const noImagesAfterDone = scanDone && generatedImages.length === 0 && (pipelineStatus === "success" || pipelineStatus === "error" || pipelineStatus === "idle");

  const handleGoNext = useCallback(() => {
    navigate("/refine");
  }, [navigate]);

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>出图生成</PageTitle>
        <PageDescription>
          正在基于确认的描述稿生成初版画面，共 {total} 张，请稍候。
        </PageDescription>

        <ProgressSection>
          <ProgressHeader>
            <ProgressTitle>生成进度</ProgressTitle>
            <ProgressCount>
              {completedCount} / {total} 张完成
            </ProgressCount>
          </ProgressHeader>
          <ProgressBar>
            <ProgressFill $progress={progress} />
          </ProgressBar>
          <ProgressMeta>
            {isDone ? (
              <StatusDot>已完成</StatusDot>
            ) : (
              <>
                <Spinner />
                <span style={{ color: theme.colors.completedText }}>生成中</span>
                {currentStep && (
                  <span style={{ color: theme.colors.textMuted }}>
                    {currentStep}
                  </span>
                )}
              </>
            )}
          </ProgressMeta>
          {currentStep && <CurrentStepLabel>{currentStep}</CurrentStepLabel>}
        </ProgressSection>

        {noImagesAfterDone && (
          <ErrorCard>
            <ErrorTitle>
              <AlertTriangle size={16} />
              未生成图片
            </ErrorTitle>
            {pipelineError && <ErrorLog>{pipelineError}</ErrorLog>}
            {pipelineOutput && <ErrorLog>{pipelineOutput}</ErrorLog>}
            {!pipelineError && !pipelineOutput && (
              <ErrorLog>管线执行完成但未产出 draft_2a 图片，可能是 Gemini API 调用失败。请检查 API Key 配额或重试。</ErrorLog>
            )}
          </ErrorCard>
        )}

        <Grid>
          {Array.from({ length: total }, (_, i) => {
            const isCompleted = i < completedCount;
            const dataUrl = imageUrls[i];
            if (isCompleted && dataUrl) {
              return (
                <VersionCardCompleted key={i}>
                  <Thumbnail src={dataUrl} alt={`Version ${i + 1}`} />
                  <CompletedBadge>
                    <Check size={12} />
                    完成
                  </CompletedBadge>
                </VersionCardCompleted>
              );
            }
            if (isCompleted) {
              return (
                <VersionCardCompleted key={i}>
                  <VersionLabel style={{ color: theme.colors.textMuted }}>
                    版本 {i + 1}
                  </VersionLabel>
                  <CompletedBadge>
                    <Check size={12} />
                    完成
                  </CompletedBadge>
                </VersionCardCompleted>
              );
            }
            return (
              <VersionCard key={i}>
                {completedCount > i - 1 ? <Spinner /> : null}
                <WaitingLabel>等待中</WaitingLabel>
              </VersionCard>
            );
          })}
        </Grid>
      </ScrollContent>

      <ActionsBar>
        <Button $variant="secondary" onClick={() => navigate("/confirm")}>
          <ArrowLeft size={14} />
          返回
        </Button>
        <Button
          $variant="primary"
          $size="lg"
          disabled={!isDone || noImagesAfterDone}
          onClick={handleGoNext}
        >
          查看结果 →
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
