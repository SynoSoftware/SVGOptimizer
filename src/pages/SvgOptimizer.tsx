import {
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  Checkbox,
  Chip,
  Label,
  Separator,
  Modal,
  ModalBody,
  ModalDialog,
  ProgressBar,
  Slider,
  Switch,
  Tabs,
  cn,
} from "@heroui/react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  FileDown,
  GripVertical,
  ImageIcon,
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  MoveHorizontal,
  Play,
  Plus,
  Replace,
  Scissors,
  Settings2,
  Timer,
  Trash2,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import Container from "../components/Container";
import Hint from "../components/Hint";

// --- WORLD CLASS LIBRARIES ---
import { AnimatePresence, Reorder, useDragControls } from "framer-motion";

// --- IMPORTS (Mocked for this example) ---
// Replace these with your actual import paths
import { optimizeSvg as optimizeCrop, DEFAULT_OPTIMIZER_OPTIONS as DEFAULT_CROP_OPTIONS } from "../utils/svgOptimizer-crop";
import { optimizeSvgRaster as optimizeRaster, DEFAULT_RASTER_OPTIONS } from "../utils/svgOptimizer-raster";
import { optimizeSvg as optimizeScissor } from "../utils/svgOptimizer-scissor";

// --- TYPES ---
type ProcessorType = "crop" | "raster" | "scissor";

interface PipelineStep {
  id: string;
  type: ProcessorType;
  active: boolean;
  options: any;
}

interface PipelineHistoryEntry {
  label: string;
  svg: string;
  sizeBytes?: number;
  durationMs?: number;
  startSizeBytes?: number;
  endSizeBytes?: number;
  isOriginal?: boolean;
}

// --- CONFIG ---
const ALGORITHM_CONFIG = {
  crop: {
    label: "Geometry",
    icon: Layers,
    accentClass: "text-accent",
    desc: "Standard vector boolean cuts",
    defaults: DEFAULT_CROP_OPTIONS,
  },
  raster: {
    label: "Raster",
    icon: ImageIcon,
    accentClass: "text-sky-500",
    desc: "Canvas coverage test, drops hidden shapes",
    defaults: DEFAULT_RASTER_OPTIONS,
  },
  scissor: {
    label: "Scissor",
    icon: Scissors,
    accentClass: "text-violet-500",
    desc: "Occlusion-based removal",
    defaults: { resolution: 1024, sensitivity: 0.5 },
  },
};

// --- HELPERS ---

const generateId = () => Math.random().toString(36).substring(2, 9);

const formatBytes = (bytes: number, decimals = 2) => {
  if (!bytes) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatDurationReadable = (ms: number, t: (key: string, options?: Record<string, any>) => string) => {
  if (ms < 1000) {
    return t("optimizer.pipeline.history.duration.ms", {
      value: Math.max(1, Math.round(ms)),
    });
  }
  if (ms < 60000) {
    const value = ms < 10000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1);
    return t("optimizer.pipeline.history.duration.seconds", { value });
  }
  return t("optimizer.pipeline.history.duration.minutes", {
    value: (ms / 60000).toFixed(1),
  });
};

const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

const generateDebugStructure = (
  svgString: string,
  {
    head = 35,
    tail = 30,
    heavyAttrs = ["d", "points", "style"],
  }: {
    head?: number;
    tail?: number;
    heavyAttrs?: string[];
  } = {},
  parseErrorText?: string
): string => {
  if (typeof window === "undefined") return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  const truncate = (val: string, isBase64: boolean) => {
    if (val.length <= head + tail) return val;
    const mid = val.length - (head + tail);
    return isBase64
      ? `${val.substring(0, head)} ... [base64:${mid}] ... ${val.substring(val.length - tail)}`
      : `${val.substring(0, head)} ... [${mid} chars] ... ${val.substring(val.length - tail)}`;
  };

  const processNode = (node: Element, indent: number): string => {
    const spaces = "  ".repeat(indent);
    const tagName = node.tagName;

    let attrs = "";
    Array.from(node.attributes).forEach((attr) => {
      let val = attr.value;

      if (heavyAttrs.includes(attr.name) && val.length > head + tail) {
        val = truncate(val, false);
      } else if (attr.name === "href" && val.startsWith("data:") && val.length > head + tail) {
        val = truncate(val, true);
      }

      attrs += ` ${attr.name}="${val}"`;
    });

    const hasChildren = node.children.length > 0;
    const closing = hasChildren ? "" : "/";

    let output = `${spaces}<${tagName}${attrs}${closing}>\n`;

    if (hasChildren) {
      Array.from(node.children).forEach((child) => {
        output += processNode(child, indent + 1);
      });
      output += `${spaces}</${tagName}>\n`;
    }

    return output;
  };

  const root = doc.documentElement;
  if (!root || root.tagName === "parsererror") return parseErrorText || "Error parsing SVG structure.";

  return processNode(root, 0);
};

const beautifySvg = (svg: string) => {
  let indent = 0;
  return svg
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      if (line.match(/^<\/\w/)) indent = Math.max(0, indent - 1);
      const padding = "  ".repeat(indent);
      const formatted = padding + line;
      if (line.match(/^<\w[^>]*[^\/]>$/) && !line.startsWith("<?") && !line.startsWith("<!")) {
        indent++;
      }
      return formatted;
    })
    .join("\n");
};

// --- SUB-COMPONENTS ---

function SettingSlider({ label, value, min, max, step, formatValue, onChange, suffix = "" }: any) {
  const displayValue = formatValue ? formatValue(value) : value?.toFixed(step < 1 ? 2 : 0);
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-foreground/60">
        <span>{label}</span>
        <span className="font-mono text-foreground/80">
          {displayValue}
          {suffix}
        </span>
      </div>
      <Slider
        aria-label={label}
        minValue={min}
        maxValue={max}
        step={step}
        value={value}
        onChange={(v) => typeof v === "number" && onChange(v)}
        className="opacity-90 hover:opacity-100"
      >
        <Slider.Track>
          <Slider.Fill />
          <Slider.Thumb />
        </Slider.Track>
      </Slider>
    </div>
  );
}

function StepSettings({ type, options, onChange }: { type: ProcessorType; options: any; onChange: (k: string, v: any) => void }) {
  const { t } = useTranslation();

  switch (type) {
    case "crop":
      return (
        <div className="grid gap-4 p-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <SettingSlider
                label={t("optimizer.pipeline.settings.fields.precision")}
                value={options.precision}
                min={0.1}
                max={4}
                step={0.1}
                onChange={(v: number) => onChange("precision", v)}
              />
            </div>
            <div className="flex-1">
              <SettingSlider
                label={t("optimizer.pipeline.settings.fields.simplify")}
                value={options.simplifyTolerance}
                min={0.1}
                max={5}
                step={0.1}
                onChange={(v: number) => onChange("simplifyTolerance", v)}
              />
            </div>
          </div>
          <div className="flex gap-4">
            <Checkbox isSelected={options.enableBooleanCuts} onChange={(v: boolean) => onChange("enableBooleanCuts", v)}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{t("optimizer.pipeline.settings.fields.boolean")}</Label>
              </Checkbox.Content>
            </Checkbox>
            <Checkbox isSelected={options.enableTraps} onChange={(v: boolean) => onChange("enableTraps", v)}>
              <Checkbox.Content>
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Label>{t("optimizer.pipeline.settings.fields.traps")}</Label>
              </Checkbox.Content>
            </Checkbox>
          </div>
        </div>
      );
    case "raster":
      return (
        <div className="grid gap-4 p-2">
          <SettingSlider
            label={t("optimizer.pipeline.settings.fields.resolution")}
            value={options.rasterBase}
            min={512}
            max={2048}
            step={128}
            suffix="px"
            onChange={(v: number) => onChange("rasterBase", v)}
          />
          <SettingSlider
            label={t("optimizer.pipeline.settings.fields.occlusion")}
            value={options.occlusionThreshold}
            min={0.9}
            max={0.995}
            step={0.005}
            onChange={(v: number) => onChange("occlusionThreshold", v)}
          />
        </div>
      );
    case "scissor":
      return (
        <div className="grid gap-4 p-2">
          <SettingSlider
            label={t("optimizer.pipeline.settings.fields.resolution")}
            value={options.resolution}
            min={512}
            max={4096}
            step={256}
            suffix="px"
            onChange={(v: number) => onChange("resolution", v)}
          />
          <SettingSlider
            label={t("optimizer.pipeline.settings.fields.sensitivity")}
            value={options.sensitivity}
            min={0.1}
            max={1.0}
            step={0.1}
            onChange={(v: number) => onChange("sensitivity", v)}
          />
        </div>
      );
    default:
      return null;
  }
}

function ComparePreview({ original, optimized, className, isFullScreen, onToggleFullScreen }: any) {
  const { t } = useTranslation();
  const [sliderPosition, setSliderPosition] = useState(50);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey || e.deltaY) {
      e.preventDefault();
      const scaleAmount = -e.deltaY * 0.001;
      setTransform((prev) => ({
        ...prev,
        k: Math.max(0.1, Math.min(20, prev.k + scaleAmount)),
      }));
    }
  };

  const zoomIn = () => setTransform((t) => ({ ...t, k: Math.min(20, t.k * 1.2) }));
  const zoomOut = () => setTransform((t) => ({ ...t, k: Math.max(0.1, t.k / 1.2) }));
  const resetView = () => setTransform({ x: 0, y: 0, k: 1 });

  const handleMouseDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest(".no-pan")) return;
    setIsPanning(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    const handleGlobalMove = (e: globalThis.MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;
        setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };
    const handleGlobalUp = () => setIsPanning(false);
    if (isPanning) {
      window.addEventListener("mousemove", handleGlobalMove);
      window.addEventListener("mouseup", handleGlobalUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleGlobalMove);
      window.removeEventListener("mouseup", handleGlobalUp);
    };
  }, [isPanning]);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || isPanning) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPosition((x / rect.width) * 100);
  };

  const transformStyle = {
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
    transformOrigin: "center",
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      className={cn(
        "group relative flex w-full overflow-hidden bg-[url('https://heroui.com/images/grid.svg')] bg-center select-none touch-none",
        isPanning ? "cursor-grabbing" : "cursor-col-resize",
        "sm:p-8 p-2",
        className || "h-[400px] rounded-xl border border-border"
      )}
    >
      {/* Toolbar */}
      <div className="no-pan absolute right-3 top-3 z-30 flex items-center gap-2">
        <ButtonGroup size="sm" className="border border-border bg-background/60 shadow-sm backdrop-blur-md">
          <Hint content={t("optimizer.preview.zoomOut")}>
            <Button isIconOnly onPress={zoomOut}>
              <Minus size={14} />
            </Button>
          </Hint>
          <Hint content={t("optimizer.preview.resetView")}>
            <Button isIconOnly onPress={resetView} className="px-3 font-mono text-xs">
              {Math.round(transform.k * 100)}%
            </Button>
          </Hint>
          <Hint content={t("optimizer.preview.zoomIn")}>
            <Button isIconOnly onPress={zoomIn}>
              <Plus size={14} />
            </Button>
          </Hint>
        </ButtonGroup>
        {onToggleFullScreen && (
          <Button isIconOnly variant="secondary" onPress={onToggleFullScreen} className="bg-accent/10 backdrop-blur-md">
            {isFullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </Button>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 z-30 flex gap-4 rounded-lg border border-border bg-background/60 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest backdrop-blur-md">
        <span className="text-foreground/60">{t("optimizer.preview.original")}</span>
        <span className="text-success">{t("optimizer.preview.optimized")}</span>
      </div>

      {/* Layers */}
      <div className="absolute inset-0 flex items-center justify-center p-8" style={{ clipPath: `inset(0 0 0 ${sliderPosition}%)` }}>
        <div
          style={transformStyle}
          className="flex h-full w-full items-center justify-center 
            [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:h-auto [&>svg]:w-auto
            transition-transform duration-75 ease-out"
        >
          <div dangerouslySetInnerHTML={{ __html: optimized }} />
        </div>
      </div>
      <div
        className="absolute inset-0 flex items-center justify-center border-r-2 border-accent bg-transparent p-8"
        style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
      >
        <div
          style={transformStyle}
          className="flex h-full w-full items-center justify-center 
            [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:h-auto [&>svg]:w-auto
            transition-transform duration-75 ease-out"
        >
          <div dangerouslySetInnerHTML={{ __html: original }} />
        </div>
      </div>

      {/* Handle */}
      <div className="absolute inset-y-0 z-20 w-0.5 bg-transparent" style={{ left: `${sliderPosition}%` }}>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transform rounded-full bg-accent p-1.5 text-accent-foreground shadow-xl transition-transform group-hover:scale-110">
          <MoveHorizontal size={12} />
        </div>
      </div>
    </div>
  );
}

// --- NEW SUB-COMPONENT TO FIX SLIDER CONFLICT ---
const PipelineStepItem = ({ step, config, updateStepOption, toggleStepActive, removeStep, t }: any) => {
  const dragControls = useDragControls();
  const Icon = config.icon;
  // The settings used to hang off an Accordion, which insisted on its own
  // full-width trigger row. That doubled the height of every step for a
  // chevron, so the disclosure now sits with the other controls.
  const [showSettings, setShowSettings] = useState(false);

  return (
    <Reorder.Item
      value={step}
      dragListener={false} // DISABLE default drag
      dragControls={dragControls} // CONNECT controls
      whileDrag={{
        scale: 1.02,
        zIndex: 20,
        boxShadow: "0 8px 20px rgba(0,0,0,0.15)",
      }}
      initial={{ opacity: 0, y: 10, height: 0 }}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={{ opacity: 0, scale: 0.9, height: 0, margin: 0 }}
      transition={{ duration: 0.2, ease: "easeInOut" }}
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-surface shadow-sm transition-colors shrink-0",
        step.active ? "border-border" : "border-separator opacity-60 grayscale"
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <div
          className="cursor-grab touch-none p-2 text-muted hover:text-foreground active:cursor-grabbing active:text-accent"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <GripVertical size={16} />
        </div>

        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary", config.accentClass)}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wider text-foreground/80">
            {t(`optimizer.pipeline.settings.algorithms.${step.type}.label`)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Switch
            isSelected={step.active}
            onChange={() => toggleStepActive(step.id)}
            aria-label={t("optimizer.pipeline.settings.toggleLabel")}
            className="scale-75"
          >
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          <Button
            isIconOnly
            variant="ghost"
            className="min-w-8 w-8 h-8"
            aria-label={t("optimizer.pipeline.settings.configure")}
            aria-expanded={showSettings}
            isDisabled={!step.active}
            onPress={() => setShowSettings((v) => !v)}
          >
            <ChevronDown size={14} className={cn("transition-transform", showSettings && "rotate-180")} />
          </Button>
          <Button isIconOnly variant="danger-soft" className="min-w-8 w-8 h-8" onPress={() => removeStep(step.id)}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>

      {step.active && showSettings && (
        <div className="border-t border-separator/50 bg-surface-secondary/30 px-3 py-3">
          <StepSettings type={step.type} options={step.options} onChange={(k: string, v: any) => updateStepOption(step.id, k, v)} />
        </div>
      )}
    </Reorder.Item>
  );
};

// --- MAIN COMPONENT ---

export default function SvgOptimizerPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [source, setSource] = useState("");
  const [result, setResult] = useState<{
    svg: string;
    history: PipelineHistoryEntry[];
    totalRuntimeMs?: number;
    originalSizeBytes?: number;
    finalSizeBytes?: number;
  } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileProcess = async (file: File) => {
    if (!file) return;
    // Simple validation to ensure it's likely an SVG
    if (!file.name.toLowerCase().endsWith(".svg") && file.type !== "image/svg+xml") {
      return;
    }
    const fileText = await file.text();
    setSource(fileText);
    setLoadedFileName(file.name);
    setResult(null);
  };
  const [pipeline, setPipeline] = useState<PipelineStep[]>([
    {
      id: "1",
      type: "crop",
      active: true,
      options: { ...DEFAULT_CROP_OPTIONS },
    },
    {
      id: "2",
      type: "raster",
      active: true,
      options: { ...DEFAULT_RASTER_OPTIONS },
    },
  ]);
  const totalSavingsPercent =
    result && typeof result.originalSizeBytes === "number" && result.originalSizeBytes > 0
      ? ((result.originalSizeBytes - (result.finalSizeBytes || 0)) / result.originalSizeBytes) * 100
      : 0;

  const addStep = (type: ProcessorType) => {
    const defaults = { ...ALGORITHM_CONFIG[type].defaults };
    setPipeline([...pipeline, { id: generateId(), type, active: true, options: defaults }]);
  };

  const removeStep = (id: string) => {
    setPipeline(pipeline.filter((p) => p.id !== id));
  };

  const updateStepOption = (id: string, key: string, val: any) => {
    setPipeline(pipeline.map((p) => (p.id === id ? { ...p, options: { ...p.options, [key]: val } } : p)));
  };

  const toggleStepActive = (id: string) => {
    setPipeline(pipeline.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  };

  // --- ENGINE ---
  const runPipeline = async () => {
    if (!source) return;
    setIsRunning(true);
    setProgress(0);
    setPipelineError(null);
    const pipelineStart = now();

    let currentSvg = source;
    const originalSize = new Blob([source]).size;
    const history: PipelineHistoryEntry[] = [
      {
        label: t("optimizer.pipeline.history.original", {
          size: formatBytes(originalSize),
        }),
        svg: source,
        sizeBytes: originalSize,
        startSizeBytes: originalSize,
        endSizeBytes: originalSize,
        isOriginal: true,
      },
    ];
    const activeSteps = pipeline.filter((p) => p.active);
    const stepWeight = 100 / (activeSteps.length || 1);

    let previousSize = originalSize;
    try {
      for (let i = 0; i < activeSteps.length; i++) {
        const step = activeSteps[i];
        const updateStepProgress = (pct: number) => setProgress(i * stepWeight + pct * (stepWeight / 100));

        // Execute Algorithm (Mocked logic hookup)
        let res: any = {};
        if (step.type === "crop") res = await optimizeCrop(currentSvg, step.options, updateStepProgress);
        else if (step.type === "raster") res = await optimizeRaster(currentSvg, step.options, updateStepProgress);
        else if (step.type === "scissor") res = await optimizeScissor(currentSvg, step.options, updateStepProgress);

        const nextSvg = res.optimizedSvg || res.svg;
        if (!nextSvg) throw new Error("step-failed");
        currentSvg = nextSvg;
        const runtimeMs =
          typeof res?.stats?.runtimeMs === "number" ? res.stats.runtimeMs : typeof res?.stats?.runtime === "number" ? res.stats.runtime : undefined;
        const sizeBytes = new Blob([currentSvg]).size;
        history.push({
          label: t(`optimizer.pipeline.settings.algorithms.${step.type}.label`),
          svg: currentSvg,
          sizeBytes,
          durationMs: runtimeMs,
          startSizeBytes: previousSize,
          endSizeBytes: sizeBytes,
        });
        previousSize = sizeBytes;
      }
      setResult({
        svg: currentSvg,
        history,
        totalRuntimeMs: now() - pipelineStart,
        originalSizeBytes: originalSize,
        finalSizeBytes: new Blob([currentSvg]).size,
      });
    } catch (e) {
      if (e instanceof Error) {
        if (e.message === "Invalid SVG input") {
          setPipelineError(t("optimizer.errors.parse"));
        } else if (e.message === "Browser environment required (OffscreenCanvas)") {
          setPipelineError(t("optimizer.errors.environment"));
        } else if (e.message === "step-failed") {
          setPipelineError(t("optimizer.errors.unknown"));
        } else {
          setPipelineError(t("optimizer.errors.unknown"));
        }
      } else {
        setPipelineError(t("optimizer.errors.unknown"));
      }
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  };

  const handleUseAsSource = () => {
    if (result) {
      setSource(result.svg);
      setResult(null);
      setLoadedFileName((prev) => (prev ? `iterated_${prev}` : "iterated.svg"));
    }
  };

  return (
    <section className="w-full py-8">
      <Container>
        {/* v3 modals take isOpen via the root and wrap the dialog in a
            container; the close callback is no longer passed as a child. */}
        <Modal isOpen={isFullScreen} onOpenChange={setIsFullScreen}>
          <Modal.Container>
            <ModalDialog className="bg-background">
              <ModalBody className="p-0">
                {result && (
                  <ComparePreview
                    original={source}
                    optimized={result.svg}
                    isFullScreen={true}
                    onToggleFullScreen={() => setIsFullScreen(false)}
                    className="h-screen w-screen rounded-none border-none"
                  />
                )}
              </ModalBody>
            </ModalDialog>
          </Modal.Container>
        </Modal>

        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="text-3xl font-bold tracking-tight">{t("optimizer.pipeline.heading")}</h1>
          <p className="text-foreground/60">{t("optimizer.pipeline.subheading")}</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
          {/* LEFT: Builder */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <Card
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.[0]) {
                  handleFileProcess(e.dataTransfer.files[0]);
                }
              }}
              className={cn(
                "shrink-0 border-2 border-dashed transition-all",
                isDragging
                  ? "border-accent bg-accent/10 scale-[1.01]"
                  : source
                    ? "border-success/50 bg-success/5"
                    : "border-border hover:border-accent/50 active:scale-[0.99]"
              )}
            >
              <CardContent className="cursor-pointer flex-col items-center justify-center p-6 text-center" onClick={() => fileInputRef.current?.click()}>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".svg"
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      handleFileProcess(e.target.files[0]);
                    }
                  }}
                />
                <Upload
                  className={cn("mb-2 transition-colors", isDragging ? "text-accent scale-110" : source ? "text-success" : "text-muted")}
                />
                <p className={cn("text-sm font-medium", isDragging && "text-accent")}>
                  {isDragging ? "Drop SVG here" : loadedFileName || t("optimizer.pipeline.upload.cta")}
                </p>
                {source && !isDragging && <p className="mt-1 text-xs text-foreground/50">{formatBytes(new Blob([source]).size)}</p>}
              </CardContent>
            </Card>
            <Card className="flex max-h-[80vh] flex-col border border-border">
              <CardHeader className="shrink-0 flex-col gap-2 px-4 py-4 bg-surface/50 backdrop-blur-sm z-10">
                <div className="flex w-full items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground/60">{t("optimizer.pipeline.panel.title")}</span>
                    <Chip variant="soft" className="h-5 min-h-0 px-1 text-[10px]">
                      {pipeline.length}
                    </Chip>
                  </div>
                  <div className="text-[10px] text-foreground/40">{t("optimizer.pipeline.panel.reorderHint")}</div>
                </div>

                {/* --- FIX 1: ALGORITHM BUTTON GRID --- */}
                {/* Mobile: 2x2 Grid (Big Squares). Desktop: 4x1 Row. */}
                <div className="grid w-full grid-cols-2 gap-2">
                  {(Object.entries(ALGORITHM_CONFIG) as [ProcessorType, any][]).map(([key, config]) => {
                    const Icon = config.icon;
                    const labelKey = `optimizer.pipeline.settings.algorithms.${key}.label`;
                    const descKey = `optimizer.pipeline.settings.algorithms.${key}.description`;
                    return (
                      <Hint
                        key={key}
                        content={
                          <div className="px-1 py-1 text-center">
                            <div className="text-xs font-bold">{t(labelKey, { defaultValue: config.label })}</div>
                            <div className="text-[10px] text-foreground/70">{t(descKey, { defaultValue: config.desc })}</div>
                          </div>
                        }
                        delay={600}
                        closeDelay={0}
                      >
                        <Button
                          variant="tertiary"
                          onPress={() => addStep(key)}
                          className={cn(
                            "group h-9 w-full min-w-0 flex items-center justify-start gap-2 px-2.5",
                            "rounded-lg border border-border bg-surface transition-colors",
                            "hover:border-accent/50 hover:bg-surface-secondary active:scale-95"
                          )}
                        >
                          <Icon size={14} strokeWidth={2.5} className={cn("shrink-0", config.accentClass)} />
                          <span className="truncate text-[10px] font-bold uppercase tracking-wide text-foreground/70">
                            {t(labelKey, { defaultValue: config.label })}
                          </span>
                        </Button>
                      </Hint>
                    );
                  })}
                </div>
              </CardHeader>

              <Separator className="opacity-50" />

              {/* PIPELINE LIST */}
              <CardContent className="flex-1 overflow-y-auto overflow-x-hidden p-3 bg-surface-secondary/30">
                {pipeline.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center text-center text-sm text-foreground/40 min-h-[150px]">
                    <Layers size={32} className="mb-2 opacity-20" />
                    <p>{t("optimizer.pipeline.empty.title")}</p>
                    <p className="text-xs opacity-70">{t("optimizer.pipeline.empty.hint")}</p>
                  </div>
                )}

                <Reorder.Group axis="y" values={pipeline} onReorder={setPipeline} className="flex flex-col gap-3" layoutScroll>
                  <AnimatePresence initial={false} mode="popLayout">
                    {pipeline.map((step) => (
                      // --- FIX 2: Using the extracted component for stable Drag/Slider ---
                      <PipelineStepItem
                        key={step.id}
                        step={step}
                        config={ALGORITHM_CONFIG[step.type]}
                        updateStepOption={updateStepOption}
                        toggleStepActive={toggleStepActive}
                        removeStep={removeStep}
                        t={t}
                      />
                    ))}
                  </AnimatePresence>
                </Reorder.Group>
              </CardContent>

              <CardFooter className="shrink-0 flex-col gap-3 p-3 pt-0 bg-surface-secondary/30 border-t border-separator/50">
                {pipelineError && (
                  <div className="mt-3 flex w-full items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 p-2 text-xs text-danger">
                    <AlertCircle size={14} />
                    <span className="truncate">{pipelineError}</span>
                  </div>
                )}
                {isRunning && (
                  <div className="flex w-full flex-col gap-1 rounded-xl border border-separator/70 bg-background/40 p-3 shadow-sm">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-foreground/50">
                      <span>{t("optimizer.form.progressLabel")}</span>
                      <span className="font-mono text-foreground">{Math.max(0, Math.min(100, Math.round(progress)))}%</span>
                    </div>
                    <ProgressBar
                      size="sm"
                      value={progress}
                      aria-label={t("optimizer.form.progressLabel")}
                      isIndeterminate={progress === 0}
                    />
                  </div>
                )}

                <Button
                  variant="primary"
                  className="w-full font-bold shadow-md shadow-accent/20 mt-3"
                  onPress={runPipeline}
                  isDisabled={isRunning || !source || pipeline.filter((p) => p.active).length === 0}
                >
                  {!isRunning && <Play size={16} fill="currentColor" className="mr-2" />}
                  {isRunning ? t("optimizer.pipeline.buttons.running") : t("optimizer.pipeline.buttons.run")}
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* RIGHT: Results */}
          <div className="flex flex-col gap-6 lg:col-span-7 lg:sticky lg:top-6">
            {!result ? (
              <div className="flex min-h-[500px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-surface/30 p-8 text-center text-foreground/40">
                <div className="mb-4 rounded-full bg-surface-tertiary p-6">
                  <Settings2 size={40} />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{t("optimizer.pipeline.results.readyTitle")}</h3>
                <p className="text-sm">{t("optimizer.pipeline.results.readyBody")}</p>
              </div>
            ) : (
              <Card className="border border-border shadow-md">
                <CardHeader className="flex flex-col sm:flex-row sm:justify-between gap-4 px-6 py-4">
                  <div className="flex flex-col">
                    <p className="text-xs font-bold uppercase text-foreground/50">{t("optimizer.pipeline.results.finalSize")}</p>

                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-bold">{formatBytes(new Blob([result.svg]).size)}</span>

                      <Chip color="success" variant="soft">
                        <Check size={12} className="mr-1 inline" aria-hidden />
                        {t("optimizer.pipeline.results.saved", {
                          percent: totalSavingsPercent.toFixed(1),
                        })}
                      </Chip>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Hint content={t("optimizer.pipeline.tooltips.moveOptimizedToSource")}>
                      <Button
                        variant="secondary"
                        onPress={handleUseAsSource}
                        className="w-full sm:w-auto"
                      >
                        {t("optimizer.pipeline.tooltips.useAsSource")}
                      </Button>
                    </Hint>

                    <Button
                      variant="primary"
                      onPress={() => {
                        const blob = new Blob([result.svg], {
                          type: "image/svg+xml",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `optimized.svg`;
                        a.click();
                      }}
                      className="w-full sm:w-auto"
                    >
                      <FileDown size={16} className="mr-2" aria-hidden />
                      {t("optimizer.pipeline.tooltips.download")}
                    </Button>
                  </div>
                </CardHeader>

                <Separator />

                <CardContent className="p-0">
                  <Tabs aria-label={t("optimizer.pipeline.tabs.resultsLabel")} variant="secondary">
                    <Tabs.List>
                      <Tabs.Tab id="preview">{t("optimizer.pipeline.tabs.preview")}</Tabs.Tab>
                      <Tabs.Tab id="code">{t("optimizer.pipeline.tabs.code")}</Tabs.Tab>
                      <Tabs.Tab id="history">{t("optimizer.pipeline.tabs.history")}</Tabs.Tab>
                    </Tabs.List>
                    <Tabs.Panel id="preview">
                      <ComparePreview original={source} optimized={result.svg} onToggleFullScreen={() => setIsFullScreen(true)} />
                    </Tabs.Panel>

                    {/* --- FIX 3: SYNTAX HIGHLIGHTING (Horizontal Scroll restored) --- */}
                    <Tabs.Panel id="code">
                      <div className="relative border-b border-border bg-[#1e1e1e] w-full">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="ghost"
                          className="absolute right-2 top-2 z-20 text-white/60 hover:text-white bg-white/5 hover:bg-white/10"
                          onPress={() => navigator.clipboard.writeText(result.svg)}
                        >
                          <Copy size={14} />
                        </Button>

                        <div className="w-full overflow-x-auto py-4 px-4 sm:px-6">
                          <pre className="whitespace-pre-wrap text-[0.8rem] leading-6 font-mono text-foreground/70">
                            {beautifySvg(result.svg)}
                          </pre>
                        </div>
                      </div>
                    </Tabs.Panel>

                    <Tabs.Panel id="history">
                      <div className="flex flex-col rounded-xl border border-border bg-surface shadow-sm overflow-hidden m-4">
                        {/* 1. Compact Summary Header */}
                        <div className="flex items-center justify-between bg-surface-tertiary/80 px-4 py-3 text-xs font-medium border-b border-border">
                          {/* LEFT: Data Flow (Original -> Result) */}
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-foreground/50">Original</span>
                              <span className="font-mono text-foreground">{formatBytes(result.originalSizeBytes || 0)}</span>
                            </div>
                            <ArrowRight size={12} className="text-foreground/30" />
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-wider text-foreground/50">Result</span>
                              <span className="font-bold text-success">{formatBytes(result.finalSizeBytes || 0)}</span>
                            </div>
                          </div>

                          {/* RIGHT: Stats + Copy Button (Aligned with steps) */}
                          <div className="flex items-center gap-3">
                            <div className="hidden sm:flex items-center gap-1.5 rounded-md bg-background/50 px-2 py-1 border border-border">
                              <Timer size={12} className="text-foreground/50" />
                              <span className="font-mono">{formatDurationReadable(result.totalRuntimeMs || 0, t)}</span>
                            </div>
                            <Chip color="success" variant="primary" className="font-bold">
                              {totalSavingsPercent > 0 ? `-${totalSavingsPercent.toFixed(1)}%` : "0%"}
                            </Chip>

                            {/* --- BUTTON MOVED HERE --- */}
                            <Hint content="Copy original structure">
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                className="text-foreground/40 hover:text-foreground"
                                onPress={() => {
                                  const parsed = generateDebugStructure(source, undefined, t("optimizer.pipeline.debug.parseError"));
                                  navigator.clipboard.writeText(parsed);
                                }}
                              >
                                <Copy size={14} />
                              </Button>
                            </Hint>
                          </div>
                        </div>

                        {/* 2. The Connected Steps List */}
                        <div className="relative flex flex-col bg-background/40">
                          {/* Vertical connector line */}
                          <div className="absolute left-6 top-4 bottom-4 w-px bg-surface-tertiary z-0" />

                          {result.history
                            .filter((entry) => !entry.isOriginal)
                            .map((entry, i) => {
                              const start = entry.startSizeBytes || 0;
                              const end = entry.endSizeBytes || 0;
                              const saved = start - end;
                              const isPositive = saved > 0;

                              return (
                                <div
                                  key={`${entry.label}-${i}`}
                                  className="relative z-10 flex items-center gap-4 border-b border-separator/50 p-3 px-4 last:border-none hover:bg-surface-secondary transition-colors group"
                                >
                                  {/* Index Badge */}
                                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground shadow-sm ring-4 ring-background">
                                    {i + 1}
                                  </div>

                                  {/* Main Info */}
                                  <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center">
                                    {/* Column 1: Label & Time */}
                                    <div className="col-span-4 flex flex-col justify-center">
                                      <span className="font-semibold text-sm truncate text-foreground">{entry.label}</span>
                                      <span className="text-[10px] text-foreground/40 font-mono flex items-center gap-1">
                                        <Timer size={8} />
                                        {entry.durationMs?.toFixed(0)}ms
                                      </span>
                                    </div>

                                    {/* Column 2: Data Flow */}
                                    <div className="col-span-5 flex items-center gap-2 text-xs font-mono text-foreground/70">
                                      <span>{formatBytes(start)}</span>
                                      <ArrowRight size={10} className="opacity-30" />
                                      <span className={cn(isPositive && "text-foreground font-medium")}>{formatBytes(end)}</span>
                                    </div>

                                    {/* Column 3: Delta Badge */}
                                    <div className="col-span-3 flex justify-end">
                                      {saved !== 0 && (
                                        <span
                                          className={cn(
                                            "text-[10px] px-1.5 py-0.5 rounded font-medium",
                                            isPositive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                                          )}
                                        >
                                          {isPositive ? "-" : "+"}
                                          {formatBytes(Math.abs(saved))}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action: Copy Step Button */}
                                  <Hint content="Copy structure for debugging">
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="ghost"
                                      className="text-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onPress={() => {
                                        const parsed = generateDebugStructure(entry.svg, undefined, t("optimizer.pipeline.debug.parseError"));
                                        navigator.clipboard.writeText(parsed);
                                      }}
                                    >
                                      <Copy size={14} />
                                    </Button>
                                  </Hint>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </Tabs.Panel>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
