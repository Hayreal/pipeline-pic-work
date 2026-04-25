import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { Button, Tag } from "../components/shared";
import { ArrowLeft, RefreshCw } from "lucide-react";
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

const TwoColumn = styled.div`
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 20px;
`;

const LeftColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const DescriptionCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
`;

const DescriptionHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const DescriptionTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
`;

const StatusBadge = styled.span`
  font-size: 11px;
  color: ${theme.colors.tagText};
  background: ${theme.colors.tagBg};
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 500;
`;

const DescriptionText = styled.div`
  font-size: 14px;
  line-height: 1.8;
  color: ${theme.colors.text};
  padding: 12px;
  background: ${theme.colors.bg};
  border-radius: ${theme.sizes.borderRadiusSm};
  min-height: 80px;
  max-height: 200px;
  overflow-y: auto;
`;

const KeywordsCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 20px;
`;

const KeywordsTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 12px;
`;

const KeywordsList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const PreviewPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PreviewCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 16px;
`;

const PreviewTitle = styled.h3`
  font-size: 13px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 12px;
`;

const PreviewGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const PreviewItem = styled.div<{ $hasImage?: boolean }>`
  aspect-ratio: 3 / 4;
  background: ${theme.colors.cardBg};
  border-radius: ${theme.sizes.borderRadiusSm};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: ${theme.colors.textMuted};
  overflow: hidden;
`;

const PreviewImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const ActionsBar = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 40px 24px;
  flex-shrink: 0;
`;

// Extract keywords from description text
function extractKeywords(description: string): { label: string; variant: "orange" | "blue" }[] {
  if (!description.trim()) return [];
  // Simple heuristic: split by punctuation, take first 6 meaningful tokens
  const colorKeywords = ["奶油色", "白色", "黑色", "红色", "蓝色", "绿色", "米色", "灰色"];
  const materialKeywords = ["针织", "罗纹", "棉质", "丝绸", "皮革", "涤纶", "麻质"];
  const poseKeywords = ["半侧身", "正面", "背面", "侧面", "45°", "俯拍", "仰拍"];

  const sentences = description.split(/[，。、\n]/).filter((s) => s.trim());
  const results: { label: string; variant: "orange" | "blue" }[] = [];

  for (const sentence of sentences.slice(0, 4)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    // Check if it's a color/material keyword
    if (colorKeywords.some((k) => trimmed.includes(k)) || materialKeywords.some((k) => trimmed.includes(k))) {
      results.push({ label: trimmed, variant: "orange" });
    } else if (poseKeywords.some((k) => trimmed.includes(k))) {
      results.push({ label: trimmed, variant: "blue" });
    } else if (results.length < 6) {
      results.push({ label: trimmed, variant: results.length % 2 === 0 ? "orange" : "blue" });
    }
  }

  return results;
}

export function ConfirmDescriptionPage() {
  const navigate = useNavigate();
  const {
    description,
    setDescription,
    keywords,
    setKeywords,
    lastRun,
    uploadedImages,
    setPipelineStatus,
    setPipelineProgress,
    setPipelineStep,
  } = useWorkflow();

  const [loading, setLoading] = useState(true);

  // Load description from pipeline output
  useEffect(() => {
    if (!lastRun?.runId || !lastRun?.runDir) {
      // No pipeline run yet — use placeholder
      setDescription(
        "请先在「准备素材」页面上传素材并运行管线。"
      );
      setLoading(false);
      return;
    }

    let mounted = true;
    const loadDescription = async () => {
      setLoading(true);
      try {
        // Try to read the look_spec_approved.json for description
        const specPath = await window.electronAPI.path.join(lastRun.runDir, "look_spec_approved.json");
        const exists = await window.electronAPI.file.exists(specPath);
        if (exists) {
          const spec = (await window.electronAPI.file.readJson(specPath)) as Record<string, unknown>;
          const desc = (spec.look_description as string) || (spec.description as string) || "";
          if (desc && mounted) {
            setDescription(desc);
          }
        }

        // Also try to read brief_2a.txt
        const briefPath = await window.electronAPI.path.join(lastRun.runDir, "brief_2a.txt");
        const briefExists = await window.electronAPI.file.exists(briefPath);
        if (briefExists && mounted) {
          const briefContent = await window.electronAPI.file.readText(briefPath);
          if (briefContent && mounted && !description) {
            setDescription(briefContent);
          }
        }
      } catch {
        // ignore
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadDescription();
    return () => {
      mounted = false;
    };
  }, [lastRun?.runId, lastRun?.runDir, setDescription]);

  // Extract keywords when description changes
  useEffect(() => {
    if (description) {
      setKeywords(extractKeywords(description).map((k) => k.label));
    }
  }, [description, setKeywords]);

  const handleRegenerate = useCallback(async () => {
    // Navigate back to prepare and re-run
    navigate("/prepare");
  }, [navigate]);

  const handleConfirm = useCallback(() => {
    // Mark pipeline as having generated images (simulated for now)
    setPipelineStatus("success");
    setPipelineProgress(100);
    setPipelineStep("Description confirmed");
    navigate("/generate");
  }, [navigate, setPipelineStatus, setPipelineProgress, setPipelineStep]);

  const keywordItems = keywords.length > 0
    ? keywords.map((kw) => ({ label: kw, variant: "orange" as const }))
    : [];

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>描述稿确认</PageTitle>
        <PageDescription>
          系统已根据素材自动生成描述稿，请审阅后确认或在文本中直接修改要点。
        </PageDescription>

        <TwoColumn>
          <LeftColumn>
            <DescriptionCard>
              <DescriptionHeader>
                <DescriptionTitle>AI 生成描述稿</DescriptionTitle>
                <StatusBadge>{loading ? "加载中" : "待确认"}</StatusBadge>
              </DescriptionHeader>
              {loading ? (
                <DescriptionText style={{ color: theme.colors.textMuted }}>
                  正在从管线输出中加载描述...
                </DescriptionText>
              ) : (
                <DescriptionText
                  contentEditable
                  suppressContentEditableWarning
                  onBlur={(e) => setDescription(e.currentTarget.textContent ?? "")}
                >
                  {description || "暂无描述，请返回准备素材页面重新运行管线。"}
                </DescriptionText>
              )}
            </DescriptionCard>

            <KeywordsCard>
              <KeywordsTitle>关键词提取</KeywordsTitle>
              <KeywordsList>
                {keywordItems.length === 0 ? (
                  <p style={{ fontSize: 12, color: theme.colors.textMuted }}>
                    暂无关键词
                  </p>
                ) : (
                  keywordItems.map((kw, i) => (
                    <Tag key={i} $variant={kw.variant}>{kw.label}</Tag>
                  ))
                )}
              </KeywordsList>
            </KeywordsCard>
          </LeftColumn>

          <PreviewPanel>
            <PreviewCard>
              <PreviewTitle>素材预览</PreviewTitle>
              <PreviewGrid>
                {uploadedImages.length === 0 ? (
                  <>
                    <PreviewItem>Look 1</PreviewItem>
                    <PreviewItem>Look 2</PreviewItem>
                    <PreviewItem>面料</PreviewItem>
                    <PreviewItem>Logo</PreviewItem>
                  </>
                ) : (
                  uploadedImages.slice(0, 4).map((img, i) => (
                    <PreviewItem key={i} $hasImage>
                      <PreviewImage src={`file://${img.path}`} alt={img.role} />
                    </PreviewItem>
                  ))
                )}
              </PreviewGrid>
            </PreviewCard>
          </PreviewPanel>
        </TwoColumn>
      </ScrollContent>

      <ActionsBar>
        <Button $variant="secondary" onClick={() => navigate("/prepare")}>
          <ArrowLeft size={14} />
          返回
        </Button>
        <Button $variant="ghost" onClick={handleRegenerate}>
          <RefreshCw size={14} />
          不满意，重新生成
        </Button>
        <Button $variant="primary" $size="lg" onClick={handleConfirm}>
          确认描述稿 →
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
