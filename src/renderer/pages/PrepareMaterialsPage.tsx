import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { Upload, FolderOpen, AlertTriangle, Loader2, Play, FileText, User, Image, Shirt, Layers } from "lucide-react";
import { theme } from "../styles/theme";
import { Button } from "../components/shared";
import { useConfig } from "../hooks/useConfig";
import { useWorkflow, type ImageRole } from "../context/WorkflowContext";

const AVAILABLE_ROLES: { value: ImageRole; label: string; icon: React.ElementType; hint: string }[] = [
  { value: "look_ref", label: "姿势参考", icon: User, hint: "人物全身照，参考姿势与光影" },
  { value: "sku_flat", label: "平铺SKU", icon: Shirt, hint: "服装平铺图" },
  { value: "fabric_detail", label: "面料特写", icon: Layers, hint: "面料/纹理细节图" },
  { value: "face", label: "脸部参考", icon: User, hint: "面部特写，用于精修" },
  { value: "logo_ref", label: "Logo 参考", icon: Image, hint: "Logo 图案，用于对位修图" },
  { value: "none", label: "不使用", icon: Image, hint: "不参与管线" },
];

const REQUIRED_ROLES: ImageRole[] = ["look_ref", "sku_flat"];

const roleForIndex = (index: number): ImageRole => {
  if (index === 0) return "look_ref";
  if (index === 1) return "sku_flat";
  if (index === 2) return "fabric_detail";
  return "none";
};

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
  padding: 20px;
  margin-bottom: 20px;
`;

const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 12px;
`;

const SectionHint = styled.p`
  font-size: 12px;
  color: ${theme.colors.textMuted};
  line-height: 1.6;
  margin-bottom: 14px;
`;

const OutputDirRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
`;

const OutputDirLabel = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.text};
  flex-shrink: 0;
`;

const OutputDirPath = styled.div`
  flex: 1;
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  padding: 8px 12px;
  font-size: 12px;
  color: ${theme.colors.textSecondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const UploadZone = styled.button`
  width: 100%;
  border: 2px dashed ${theme.colors.uploadBorder};
  border-radius: ${theme.sizes.borderRadius};
  padding: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.15s;
  background: transparent;
  color: inherit;

  &:hover {
    border-color: ${theme.colors.uploadBorderHover};
    background: rgba(74, 158, 255, 0.03);
  }
`;

const UploadHint = styled.p`
  font-size: 12px;
  color: ${theme.colors.textMuted};
`;

const ClassificationGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
`;

const ImageCard = styled.div`
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const ImagePreview = styled.div`
  aspect-ratio: 3 / 4;
  background: ${theme.colors.cardBg};
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
`;

const Thumbnail = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const CardBody = styled.div`
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const FileName = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: ${theme.colors.text};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RoleSelector = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const RoleChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid ${({ $active }) => ($active ? theme.colors.primary : theme.colors.border)};
  background: ${({ $active }) => ($active ? "rgba(74, 158, 255, 0.14)" : "transparent")};
  color: ${({ $active }) => ($active ? theme.colors.primary : theme.colors.textMuted)};
  font-size: 10px;
  font-family: ${theme.fonts.family};
  cursor: pointer;
  white-space: nowrap;
`;

const PromptLabel = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: ${theme.colors.text};
  margin-bottom: 8px;
`;

const PromptTextarea = styled.textarea`
  width: 100%;
  min-height: 88px;
  background: ${theme.colors.bg};
  border: 1px solid ${theme.colors.border};
  border-radius: ${theme.sizes.borderRadiusSm};
  color: ${theme.colors.text};
  padding: 10px 12px;
  font-size: 13px;
  font-family: ${theme.fonts.family};
  resize: vertical;
  outline: none;
`;

const StatusCard = styled(SectionCard)`
  margin-top: 20px;
`;

const StatusTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: ${theme.colors.text};
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusLog = styled.pre`
  font-size: 11px;
  color: ${theme.colors.textSecondary};
  background: ${theme.colors.bg};
  padding: 10px 12px;
  border-radius: ${theme.sizes.borderRadiusSm};
  max-height: 180px;
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

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const ModalCard = styled.div`
  background: ${theme.colors.contentBg};
  border-radius: ${theme.sizes.borderRadius};
  padding: 28px 32px;
  max-width: 480px;
  width: 90%;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const MissingRolesBar = styled.div`
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
`;

const MissingRoleTag = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(255, 95, 87, 0.12);
  color: ${theme.colors.danger};
  font-size: 11px;
  font-weight: 500;
`;

export function PrepareMaterialsPage() {
  const navigate = useNavigate();
  const { config, isConfigured } = useConfig();
  const {
    outputDir,
    setOutputDir,
    setLastRun,
    uploadedImages,
    setUploadedImages,
    setGeneratedImages,
    setPipelineStatus,
    setPipelineProgress,
    setPipelineStep,
    setPipelineOutput,
    setPipelineError,
    promptExtra,
    setPromptExtra,
    setRole,
  } = useWorkflow();

  const [showDirModal, setShowDirModal] = useState(false);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptOutput, setScriptOutput] = useState<string | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  // Load thumbnails for uploaded images
  useEffect(() => {
    if (uploadedImages.length === 0) {
      setImageUrls({});
      return;
    }
    let mounted = true;
    const load = async () => {
      const urls: Record<number, string> = {};
      for (let i = 0; i < uploadedImages.length; i++) {
        const img = uploadedImages[i];
        if (!img) continue;
        try {
          const dataUrl = await window.electronAPI.file.readAsDataURL(img.path);
          if (dataUrl) urls[i] = dataUrl;
        } catch {
          // ignore
        }
      }
      if (mounted) setImageUrls(urls);
    };
    load();
    return () => { mounted = false; };
  }, [uploadedImages.map((img) => img.path).join(",")]);

  useEffect(() => {
    if (!outputDir) {
      setShowDirModal(true);
    }
  }, [outputDir]);

  const handleFileSelect = useCallback(async () => {
    const result = await window.electronAPI.file.select();
    if (!result.canceled && result.filePaths.length > 0) {
      const existingCount = uploadedImages.length;
      const newImages = result.filePaths.map((filePath, idx) => {
        const role = roleForIndex(existingCount + idx);
        return { path: filePath, role };
      });
      setUploadedImages([...uploadedImages, ...newImages]);
    }
  }, [uploadedImages, setUploadedImages]);

  const handleClear = useCallback(() => {
    setUploadedImages([]);
    setPromptExtra("");
    setScriptOutput(null);
    setScriptError(null);
    setGeneratedImages([]);
    setPipelineStatus("idle");
    setPipelineProgress(0);
    setPipelineStep("");
    setPipelineOutput("");
    setPipelineError("");
    setImageUrls({});
  }, [setUploadedImages, setPromptExtra, setGeneratedImages, setPipelineStatus, setPipelineProgress, setPipelineStep, setPipelineOutput, setPipelineError]);

  const handlePickOutputDir = useCallback(async () => {
    const folder = await window.electronAPI.file.saveFolder();
    if (folder) {
      setOutputDir(folder);
      setShowDirModal(false);
    }
  }, [setOutputDir]);

  const getMissingRoles = (): ImageRole[] => {
    const assignedRoles = new Set(uploadedImages.map((img) => img.role));
    return REQUIRED_ROLES.filter((r) => !assignedRoles.has(r));
  };

  const handleStart = useCallback(async () => {
    if (!isConfigured()) {
      navigate("/settings");
      return;
    }
    if (!outputDir) {
      setShowDirModal(true);
      return;
    }

    const missing = getMissingRoles();
    if (missing.length > 0) {
      setScriptError(`缺少必要的角色分类：${missing.join("、")}。请为每张图片指定用途。`);
      setScriptOutput(null);
      return;
    }

    const lookRef = uploadedImages.find((img) => img.role === "look_ref");
    const skuRef = uploadedImages.find((img) => img.role === "sku_flat");
    const fabricRef = uploadedImages.find((img) => img.role === "fabric_detail");
    const faceRef = uploadedImages.find((img) => img.role === "face");
    const logoRef = uploadedImages.find((img) => img.role === "logo_ref");

    if (!lookRef || !skuRef) {
      setScriptError("必须指定姿势参考和平铺SKU。");
      setScriptOutput(null);
      return;
    }

    setScriptRunning(true);
    setScriptOutput(null);
    setScriptError(null);
    setPipelineStatus("running");
    setPipelineProgress(0);
    setPipelineStep("Initializing...");

    const runId = `run-${Date.now()}`;
    const fixture: Record<string, unknown> = {
      run_id: runId,
      look_ref: lookRef.path,
      sku_flat: skuRef.path,
      fabric_detail: fabricRef?.path ?? skuRef.path,
    };

    if (faceRef) fixture.face = faceRef.path;
    if (logoRef) fixture.logo_ref = logoRef.path;

    try {
      const result = await window.electronAPI.script.run({
        geminiApiKey: config.geminiApiKey,
        geminiBaseUrl: config.geminiBaseUrl,
        genModel2A: config.genModel2A,
        genImageSize: config.genImageSize,
        genImageAspectRatio: config.genImageAspectRatio,
        fixture,
        outputDir,
        through: "draft",
        extraPrompt: promptExtra.trim() || undefined,
      });

      if (!result.success) {
        setScriptError(result.error || "Script execution failed.");
        setScriptOutput(result.output);
        setScriptRunning(false);
        setPipelineStatus("error");
        setPipelineOutput(result.output);
        setPipelineError(result.error || "");
        return;
      }

      setScriptOutput(result.output);
      setPipelineOutput(result.output);
      setPipelineError("");
      setLastRun({
        runId,
        runDir: result.runDir ?? "",
        outputDir,
        completedAt: Date.now(),
      });
      setPipelineStatus("success");
      setPipelineProgress(100);
      setPipelineStep("Complete");

      setTimeout(() => {
        setScriptRunning(false);
        navigate("/confirm");
      }, 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Script execution failed.";
      setScriptError(message);
      setScriptRunning(false);
      setPipelineStatus("error");
    }
  }, [
    config,
    uploadedImages,
    isConfigured,
    navigate,
    outputDir,
    promptExtra,
    setLastRun,
    setPipelineStatus,
    setPipelineProgress,
    setPipelineStep,
    setPipelineOutput,
    setPipelineError,
  ]);

  const missingRoles = getMissingRoles();

  return (
    <PageContent>
      <ScrollContent>
        <PageTitle>准备素材</PageTitle>
        <PageDescription>
          上传图片后，为每张图片指定用途角色。至少需要姿势参考和平铺SKU各一张。
        </PageDescription>

        <OutputDirRow>
          <OutputDirLabel>输出文件夹</OutputDirLabel>
          <OutputDirPath>{outputDir || "未选择"}</OutputDirPath>
          <Button $variant="secondary" onClick={() => setShowDirModal(true)}>
            <FolderOpen size={14} />
            选择目录
          </Button>
        </OutputDirRow>

        <SectionCard>
          <SectionTitle>上传素材</SectionTitle>
          <SectionHint>
            点击上传或拖拽文件。支持的格式：JPG、PNG、WEBP。至少需要姿势参考和平铺SKU两张图片。
          </SectionHint>
          <UploadZone type="button" onClick={handleFileSelect}>
            <Upload size={24} />
            <div>点击选择图片</div>
            <UploadHint>支持多选</UploadHint>
          </UploadZone>
        </SectionCard>

        {uploadedImages.length > 0 && (
          <SectionCard>
            <SectionTitle>素材分类</SectionTitle>
            <SectionHint>
              为每张图片选择其用途。标记为"不使用"的图片不会参与管线处理。
            </SectionHint>
            <ClassificationGrid>
              {uploadedImages.map((img, index) => {
                const name = img.path.split(/[\\/]/).pop() || `image-${index + 1}`;
                const Icon = AVAILABLE_ROLES.find((r) => r.value === img.role)?.icon ?? User;
                return (
                  <ImageCard key={`${img.path}-${index}`}>
                    <ImagePreview>
                      {imageUrls[index] ? (
                        <Thumbnail src={imageUrls[index]} alt={name} />
                      ) : (
                        <Icon size={32} color={theme.colors.textMuted} />
                      )}
                    </ImagePreview>
                    <CardBody>
                      <FileName title={name}>{name}</FileName>
                      <RoleSelector>
                        {AVAILABLE_ROLES.map((r) => (
                          <RoleChip
                            key={r.value}
                            $active={img.role === r.value}
                            onClick={() => setRole(index, r.value)}
                          >
                            {r.label}
                          </RoleChip>
                        ))}
                      </RoleSelector>
                    </CardBody>
                  </ImageCard>
                );
              })}
            </ClassificationGrid>
            {missingRoles.length > 0 && (
              <MissingRolesBar>
                {missingRoles.map((r) => (
                  <MissingRoleTag key={r}>缺少: {r}</MissingRoleTag>
                ))}
              </MissingRolesBar>
            )}
          </SectionCard>
        )}

        <SectionCard>
          <PromptLabel htmlFor="prompt-extra">附加提示词（可选）</PromptLabel>
          <PromptTextarea
            id="prompt-extra"
            placeholder="附加要求将传递给理解和2A生成步骤。"
            value={promptExtra}
            onChange={(event) => setPromptExtra(event.target.value)}
          />
        </SectionCard>

        {scriptRunning && (
          <StatusCard>
            <StatusTitle>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              管线运行中
            </StatusTitle>
            <StatusLog>{scriptOutput || "启动中..."}</StatusLog>
          </StatusCard>
        )}

        {scriptError && (
          <StatusCard>
            <StatusTitle>
              <AlertTriangle size={14} color={theme.colors.danger} />
              执行失败
            </StatusTitle>
            <StatusLog>{scriptError}</StatusLog>
            {scriptOutput && <StatusLog>{scriptOutput}</StatusLog>}
          </StatusCard>
        )}

        {scriptOutput && !scriptRunning && !scriptError && (
          <StatusCard>
            <StatusTitle>
              <FileText size={14} />
              管线输出
            </StatusTitle>
            <StatusLog>{scriptOutput}</StatusLog>
          </StatusCard>
        )}
      </ScrollContent>

      <ActionsBar>
        <Button $variant="danger" onClick={handleClear} disabled={scriptRunning}>
          清除
        </Button>
        <Button $variant="primary" $size="lg" onClick={handleStart} disabled={scriptRunning}>
          {scriptRunning ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={14} />}
          {scriptRunning ? "运行中..." : "开始分析 →"}
        </Button>
      </ActionsBar>

      {showDirModal && (
        <ModalOverlay>
          <ModalCard>
            <SectionTitle>选择输出文件夹</SectionTitle>
            <SectionHint>
              此文件夹仅用于生成的 fixture 快照和 UI 导出。
            </SectionHint>
            <Button $variant="secondary" onClick={handlePickOutputDir}>
              <FolderOpen size={14} />
              选择文件夹
            </Button>
          </ModalCard>
        </ModalOverlay>
      )}
    </PageContent>
  );
}
