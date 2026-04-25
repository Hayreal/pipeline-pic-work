import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ImageRole = "look_ref" | "sku_flat" | "fabric_detail" | "face" | "logo_ref" | "none";

export interface UploadedImage {
  path: string;
  role: ImageRole;
}

export interface LastRunMeta {
  runId: string;
  runDir: string;
  outputDir: string;
  completedAt: number;
}

export interface GeneratedImage {
  path: string;
  label: string;
}

export interface RefineOptions {
  refinePass: boolean;
  faceEdit: boolean;
  detailEdit: boolean;
  resolution: string;
}

export type PipelineStatus = "idle" | "running" | "success" | "error";

export interface WorkflowState {
  uploadedImages: UploadedImage[];
  setUploadedImages: (images: UploadedImage[]) => void;
  setRole: (index: number, role: ImageRole) => void;
  outputDir: string;
  setOutputDir: (dir: string) => void;
  lastRun: LastRunMeta | null;
  setLastRun: (meta: LastRunMeta | null) => void;
  description: string;
  setDescription: (desc: string) => void;
  keywords: string[];
  setKeywords: (kw: string[]) => void;
  generatedImages: GeneratedImage[];
  setGeneratedImages: (imgs: GeneratedImage[]) => void;
  pipelineStatus: PipelineStatus;
  setPipelineStatus: (status: PipelineStatus) => void;
  pipelineProgress: number;
  setPipelineProgress: (pct: number) => void;
  pipelineStep: string;
  setPipelineStep: (step: string) => void;
  pipelineOutput: string;
  setPipelineOutput: (out: string) => void;
  pipelineError: string;
  setPipelineError: (err: string) => void;
  refineOptions: RefineOptions;
  setRefineOptions: (opts: Partial<RefineOptions>) => void;
  promptExtra: string;
  setPromptExtra: (p: string) => void;
}

const WorkflowContext = createContext<WorkflowState | null>(null);

const LAST_RUN_KEY = "ai-image-workbench-last-run";
const OUTPUT_DIR_KEY = "ai-image-workbench-output-dir";

function loadLastRun(): LastRunMeta | null {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

function loadOutputDir(): string {
  try {
    return localStorage.getItem(OUTPUT_DIR_KEY) || "";
  } catch {
    return "";
  }
}

export function WorkflowProvider({ children }: { children: ReactNode }) {

  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [outputDir, setOutputDir] = useState(loadOutputDir);
  const [lastRun, setLastRun] = useState<LastRunMeta | null>(loadLastRun);
  const [description, setDescription] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>("idle");
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineStep, setPipelineStep] = useState("");
  const [pipelineOutput, setPipelineOutput] = useState("");
  const [pipelineError, setPipelineError] = useState("");
  const [refineOptions, setRefineOptionsRaw] = useState<RefineOptions>({
    refinePass: true,
    faceEdit: false,
    detailEdit: false,
    resolution: "4k",
  });
  const [promptExtra, setPromptExtra] = useState("");

  const setRefineOptions = useCallback((patch: Partial<RefineOptions>) => {
    setRefineOptionsRaw((prev) => ({ ...prev, ...patch }));
  }, []);

  const setRole = useCallback((index: number, role: ImageRole) => {
    setUploadedImages((prev) => {
      const next = [...prev];
      const current = next[index];
      if (current) {
        next[index] = { path: current.path, role };
      }
      return next;
    });
  }, []);

  const setOutputDirPersisted = useCallback((dir: string) => {
    setOutputDir(dir);
    try {
      localStorage.setItem(OUTPUT_DIR_KEY, dir);
    } catch {
      // ignore
    }
  }, []);

  const setLastRunPersisted = useCallback((meta: LastRunMeta | null) => {
    setLastRun(meta);
    if (meta) {
      try {
        localStorage.setItem(LAST_RUN_KEY, JSON.stringify(meta));
      } catch {
        // ignore
      }
    }
  }, []);

  const value = useMemo<WorkflowState>(
    () => ({
      uploadedImages,
      setUploadedImages,
      setRole,
      outputDir,
      setOutputDir: setOutputDirPersisted,
      lastRun,
      setLastRun: setLastRunPersisted,
      description,
      setDescription,
      keywords,
      setKeywords,
      generatedImages,
      setGeneratedImages,
      pipelineStatus,
      setPipelineStatus,
      pipelineProgress,
      setPipelineProgress,
      pipelineStep,
      setPipelineStep,
      pipelineOutput,
      setPipelineOutput,
      pipelineError,
      setPipelineError,
      refineOptions,
      setRefineOptions,
      promptExtra,
      setPromptExtra,
    }),
    [
      uploadedImages,
      setUploadedImages,
      setRole,
      outputDir,
      setOutputDirPersisted,
      lastRun,
      setLastRunPersisted,
      description,
      keywords,
      generatedImages,
      pipelineStatus,
      pipelineProgress,
      pipelineStep,
      pipelineOutput,
      pipelineError,
      refineOptions,
      setRefineOptions,
      promptExtra,
    ],
  );

  return (
    <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
  );
}

export function useWorkflow(): WorkflowState {
  const ctx = useContext(WorkflowContext);
  if (!ctx) {
    throw new Error("useWorkflow must be used within WorkflowProvider");
  }
  return ctx;
}
