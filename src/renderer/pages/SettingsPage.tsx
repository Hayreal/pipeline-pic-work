import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { theme } from "../styles/theme";
import { Button } from "../components/shared";
import { useConfig } from "../hooks/useConfig";
import { ArrowLeft, Save, Check, Loader2, AlertCircle } from "lucide-react";

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

const SectionCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 24px;
  margin-bottom: 20px;
`;

const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 16px;
`;

const FormField = styled.div`
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
`;

const FieldLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: ${theme.colors.textSecondary};
  margin-bottom: 6px;
`;

const FieldHint = styled.span`
  font-size: 11px;
  color: ${theme.colors.textMuted};
  font-weight: 400;
`;

const FieldInput = styled.input`
  width: 100%;
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.text};
  padding: 8px 12px;
  font-size: 13px;
  font-family: ${theme.fonts.family};
  outline: none;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${theme.colors.primary};
  }

  &::placeholder {
    color: ${theme.colors.textMuted};
  }
`;

const FieldSelect = styled.select`
  width: 100%;
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.text};
  padding: 8px 12px;
  font-size: 13px;
  font-family: ${theme.fonts.family};
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${theme.colors.primary};
  }
`;

const RequiredMark = styled.span`
  color: ${theme.colors.danger};
  font-size: 11px;
`;

const SaveStatus = styled.div<{ $saved: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: ${({ $saved }) => ($saved ? theme.colors.completedText : theme.colors.textMuted)};
  margin-left: 12px;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: ${theme.colors.bg};
  border-radius: ${theme.sizes.borderRadiusSm};
  font-size: 12px;
  color: ${theme.colors.textSecondary};
`;

const StatusDot = styled.div<{ $ok: boolean }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $ok }) => ($ok ? theme.colors.completedText : theme.colors.danger)};
`;

const ActionsBar = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 40px 24px;
  flex-shrink: 0;
`;

export function SettingsPage() {
  const navigate = useNavigate();
  const { config, update } = useConfig();
  const [saved, setSaved] = useState(false);
  const [pipelineReady, setPipelineReady] = useState<boolean | null>(null);
  const [initStep, setInitStep] = useState("");
  const [initError, setInitError] = useState("");

  useEffect(() => {
    // Check pipeline status on mount
    window.electronAPI.pipeline.getStatus().then((status) => {
      setPipelineReady(status.ready);
    });

    // Listen for init progress
    const handler = (data: { step: string; error?: string }) => {
      setInitStep(data.step);
      if (data.error) {
        setInitError(data.error);
        setPipelineReady(false);
      }
      if (data.step.includes("Pipeline ready") || data.step.includes("done")) {
        setPipelineReady(true);
      }
    };
    window.electronAPI.pipeline.onInit(handler);
    return () => {
      window.electronAPI.pipeline.removeInitListener(handler);
    };
  }, []);

  const handleSave = useCallback(() => {
    update(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [config, update]);

  const handleInitPipeline = useCallback(async () => {
    setPipelineReady(null);
    setInitStep("Initializing...");
    setInitError("");
    const result = await window.electronAPI.pipeline.init();
    if (!result.success) {
      setInitError(result.error || "Initialization failed");
      setPipelineReady(false);
    }
  }, []);

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>设置</PageTitle>
        <PageDescription>
          配置 Gemini API 和出图参数。Python 管线环境已内置，自动管理。
        </PageDescription>

        <SectionCard>
          <SectionTitle>API 配置</SectionTitle>

          <FormField>
            <FieldLabel>
              Gemini API Key <RequiredMark>*</RequiredMark>
            </FieldLabel>
            <FieldInput
              type="password"
              placeholder="输入你的 Gemini API Key"
              value={config.geminiApiKey}
              onChange={(e) => update({ geminiApiKey: e.target.value })}
            />
          </FormField>

          <FormField>
            <FieldLabel>
              Base URL
              <FieldHint>（可选，留空使用默认端点）</FieldHint>
            </FieldLabel>
            <FieldInput
              placeholder="https://generativelanguage.googleapis.com"
              value={config.geminiBaseUrl}
              onChange={(e) => update({ geminiBaseUrl: e.target.value })}
            />
          </FormField>
        </SectionCard>

        <SectionCard>
          <SectionTitle>出图参数</SectionTitle>

          <FormField>
            <FieldLabel>2A 生成模型</FieldLabel>
            <FieldInput
              placeholder="gemini-3.1-flash-image-preview"
              value={config.genModel2A}
              onChange={(e) => update({ genModel2A: e.target.value })}
            />
          </FormField>

          <FormField>
            <FieldLabel>输出尺寸</FieldLabel>
            <FieldSelect
              value={config.genImageSize}
              onChange={(e) => update({ genImageSize: e.target.value })}
            >
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </FieldSelect>
          </FormField>

          <FormField>
            <FieldLabel>输出比例</FieldLabel>
            <FieldSelect
              value={config.genImageAspectRatio}
              onChange={(e) => update({ genImageAspectRatio: e.target.value })}
            >
              <option value="1:1">1:1</option>
              <option value="2:3">2:3</option>
              <option value="3:2">3:2</option>
              <option value="3:4">3:4</option>
              <option value="4:3">4:3</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
              <option value="21:9">21:9</option>
            </FieldSelect>
          </FormField>
        </SectionCard>

        <SectionCard>
          <SectionTitle>管线环境状态</SectionTitle>
          {pipelineReady === null ? (
            <StatusRow>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              检查中...
            </StatusRow>
          ) : pipelineReady ? (
            <StatusRow>
              <StatusDot $ok />
              已就绪
            </StatusRow>
          ) : initStep && !initError ? (
            <StatusRow>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              {initStep}
            </StatusRow>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <StatusRow>
                <AlertCircle size={14} color={theme.colors.danger} />
                未就绪
                {initError && <span style={{ color: theme.colors.danger }}>{initError}</span>}
              </StatusRow>
              <Button $variant="secondary" onClick={handleInitPipeline} disabled={pipelineReady === null}>
                <Loader2 size={14} />
                初始化管线环境
              </Button>
              <FieldHint>首次初始化需要联网下载 uv 和 Python 依赖，大约 1-3 分钟。</FieldHint>
            </div>
          )}
        </SectionCard>
      </ScrollContent>

      <ActionsBar>
        <Button $variant="secondary" onClick={() => navigate(-1)}>
          <ArrowLeft size={14} />
          返回
        </Button>
        <Button $variant="primary" $size="lg" onClick={handleSave}>
          <Save size={14} />
          保存配置
          {saved && (
            <SaveStatus $saved={saved}>
              <Check size={12} />
              已保存
            </SaveStatus>
          )}
        </Button>
      </ActionsBar>
    </PageContent>
  );
}
