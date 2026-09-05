import paper from "paper/dist/paper-core";
import SVGPathCommander from "svg-path-commander";
import {
  optimizeSvgRaster,
  type RasterOptimizationOptions,
  DEFAULT_RASTER_OPTIONS,
} from "./svgOptimizer-raster";

const OPACITY_EPS = 5e-3;

type OptimizerConfig = {
  minArea: number;
  simplifyTolerance: number;
  paperCanvasMax: number;
  precision: number;
  pathImproveThreshold: number;
  trapMin: number;
  trapMax: number;
  fragmentationThreshold: number;
  maxComplexityRatio: number;
  minFragmentArea: number;
  minFragmentThickness: number;
  enableBooleanCuts: boolean;
  enableTraps: boolean;
};

const DEFAULT_CONFIG: OptimizerConfig = {
  minArea: 16,
  simplifyTolerance: 1.0,
  paperCanvasMax: 2048,
  precision: 1, // Balanced precision (matches the "Slow" version better than 0)
  pathImproveThreshold: 0.95,
  trapMin: 0.3,
  trapMax: 1.8,
  fragmentationThreshold: 1.05,
  maxComplexityRatio: 3.0,
  minFragmentArea: 4.0,
  minFragmentThickness: 0.25,
  enableBooleanCuts: true,
  enableTraps: true,
};

export type OptimizerMode = "geometry" | "raster" | "hybrid";

export type GeometryOptimizationOptions = Partial<
  Pick<
    OptimizerConfig,
    | "precision"
    | "simplifyTolerance"
    | "minArea"
    | "maxComplexityRatio"
    | "minFragmentArea"
    | "fragmentationThreshold"
    | "enableBooleanCuts"
    | "enableTraps"
  >
>;

export type OptimizerOptions = GeometryOptimizationOptions & {
  mode?: OptimizerMode;
  rasterOptions?: RasterOptimizationOptions;
};

export const DEFAULT_OPTIMIZER_OPTIONS: OptimizerOptions = {
  precision: DEFAULT_CONFIG.precision,
  simplifyTolerance: DEFAULT_CONFIG.simplifyTolerance,
  minArea: DEFAULT_CONFIG.minArea,
  maxComplexityRatio: DEFAULT_CONFIG.maxComplexityRatio,
  minFragmentArea: DEFAULT_CONFIG.minFragmentArea,
  fragmentationThreshold: DEFAULT_CONFIG.fragmentationThreshold,
  enableBooleanCuts: DEFAULT_CONFIG.enableBooleanCuts,
  enableTraps: DEFAULT_CONFIG.enableTraps,
  mode: "geometry",
  rasterOptions: { ...DEFAULT_RASTER_OPTIONS },
};

function buildConfig(options?: GeometryOptimizationOptions): OptimizerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    precision: clamp(options?.precision ?? DEFAULT_CONFIG.precision, 0.25, 4),
    simplifyTolerance: clamp(
      options?.simplifyTolerance ?? DEFAULT_CONFIG.simplifyTolerance,
      0.1,
      10
    ),
    minArea: Math.max(options?.minArea ?? DEFAULT_CONFIG.minArea, 0),
    maxComplexityRatio: Math.max(
      options?.maxComplexityRatio ?? DEFAULT_CONFIG.maxComplexityRatio,
      1.1
    ),
    minFragmentArea: Math.max(
      options?.minFragmentArea ?? DEFAULT_CONFIG.minFragmentArea,
      0
    ),
    fragmentationThreshold: Math.max(
      options?.fragmentationThreshold ?? DEFAULT_CONFIG.fragmentationThreshold,
      1
    ),
  };
}

const SHAPE_TAGS = new Set([
  "path",
  "polygon",
  "polyline",
  "rect",
  "circle",
  "ellipse",
  "line",
]);

const GEOMETRY_ATTRS = new Set([
  "d",
  "points",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "transform",
]);

const GROUPABLE_ATTRS = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "color",
  "opacity",
  "fill-opacity",
  "stroke-opacity"
]);

const UNIQUE_ATTRS = new Set([
  "id",
  "class",
  "style",
  "visibility",
  "fill-rule",
  "mix-blend-mode",
]);

type ViewportSize = { width: number; height: number };
type AttributeExtraction = {
  inheritable: Record<string, string>;
  unique: Record<string, string>;
};
type ImportedShape = {
  path: paper.PathItem;
  attrs: AttributeExtraction;
  originalD: string;
  isSolid: boolean;
  strokeWidth?: number;
};
type ProcessedShape = {
  pathData: string;
  inheritable: Record<string, string>;
  unique: Record<string, string>;
};

export type OptimizationChangeKey =
  | "removedInvisible"
  | "removedDegenerate"
  | "gapRepaired"
  | "pathsOptimized"
  | "booleanMerged"
  | "hiddenLayers"
  | "flattenedTransforms"
  | "fallbackTriggered";

export type OptimizationStep = { key: OptimizationChangeKey; count: number };

export type OptimizationStats = {
  initialBytes: number;
  optimizedBytes: number;
  removedElements: number;
  invisibleElements: number;
  degenerateElements: number;
  optimizedPaths: number;
  runtimeMs: number;
  gapRepairs: number;
  booleanUnions: number;
  hiddenLayers: number;
  flattenedTransforms: number;
  fallbackTriggered: number;
};

export type OptimizationOutcome = {
  optimizedSvg: string;
  stats: OptimizationStats;
  steps: OptimizationStep[];
};

const now =
  typeof performance !== "undefined"
    ? () => performance.now()
    : () => Date.now();

const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

// ===================== PUBLIC API =====================

export async function optimizeSvgGeometry(
  source: string,
  options?: GeometryOptimizationOptions,
  onProgress?: (percent: number) => void
): Promise<OptimizationOutcome> {
  const trimmed = source.trim();
  if (!trimmed) throw new Error("optimizer.errors.empty");

  const stats: OptimizationStats = {
    initialBytes: byteSize(trimmed),
    optimizedBytes: 0,
    removedElements: 0,
    invisibleElements: 0,
    degenerateElements: 0,
    optimizedPaths: 0,
    runtimeMs: 0,
    gapRepairs: 0,
    booleanUnions: 0,
    hiddenLayers: 0,
    flattenedTransforms: 0,
    fallbackTriggered: 0,
  };

  const startTime = now();
  const config = buildConfig(options);

  try {
    if (onProgress) onProgress(5);

    const result = await runAdvancedOptimization(
      trimmed,
      config,
      stats,
      startTime,
      onProgress
    );

    // Keep the rebuilt document only if it is cheaper to ship than the input.
    if (
      (await compressedSize(result.optimizedSvg)) >
      (await compressedSize(trimmed))
    ) {
      throw new Error("Optimization bloated file");
    }

    return result;
  } catch (err) {
    if (stats.fallbackTriggered === 0) {
      stats.fallbackTriggered = 1;
      stats.removedElements = 0;
      stats.booleanUnions = 0;
      stats.optimizedPaths = 0;
    }
    return runSafeOptimization(trimmed, config.precision, stats, startTime);
  }
}

export async function optimizeSvg(
  source: string,
  options?: OptimizerOptions,
  onProgress?: (percent: number) => void
): Promise<OptimizationOutcome> {
  const {
    rasterOptions = DEFAULT_RASTER_OPTIONS,
    mode = "geometry",
    ...geometryOptions
  } = options ?? {};

  if (mode === "raster") {
    const rasterProgress = onProgress
      ? (p: number) => onProgress(Math.min(100, Math.max(0, Math.floor(p))))
      : undefined;
    return optimizeSvgRaster(
      source,
      { precision: geometryOptions.precision, ...rasterOptions },
      rasterProgress
    );
  }

  const progressGeometry = onProgress
    ? (p: number) => onProgress(mode === "hybrid" ? Math.floor(p * 0.6) : p)
    : undefined;

  const geometryResult = await optimizeSvgGeometry(
    source,
    geometryOptions,
    progressGeometry
  );

  if (mode === "geometry") {
    return geometryResult;
  }

  const progressRaster = onProgress
    ? (p: number) => onProgress(60 + Math.floor((p * 40) / 100))
    : undefined;

  let rasterResult: OptimizationOutcome | null = null;
  try {
    rasterResult = await optimizeSvgRaster(
      geometryResult.optimizedSvg,
      { precision: geometryOptions.precision, ...rasterOptions },
      progressRaster
    );
  } catch {
    return geometryResult;
  }

  if (!rasterResult) return geometryResult;

  const combinedStats: OptimizationStats = {
    initialBytes: geometryResult.stats.initialBytes,
    optimizedBytes: rasterResult.stats.optimizedBytes,
    removedElements:
      geometryResult.stats.removedElements + rasterResult.stats.removedElements,
    invisibleElements:
      geometryResult.stats.invisibleElements +
      rasterResult.stats.invisibleElements,
    degenerateElements:
      geometryResult.stats.degenerateElements +
      rasterResult.stats.degenerateElements,
    optimizedPaths:
      geometryResult.stats.optimizedPaths + rasterResult.stats.optimizedPaths,
    runtimeMs:
      geometryResult.stats.runtimeMs + rasterResult.stats.runtimeMs,
    gapRepairs:
      geometryResult.stats.gapRepairs + rasterResult.stats.gapRepairs,
    booleanUnions:
      geometryResult.stats.booleanUnions + rasterResult.stats.booleanUnions,
    hiddenLayers:
      geometryResult.stats.hiddenLayers + rasterResult.stats.hiddenLayers,
    flattenedTransforms:
      geometryResult.stats.flattenedTransforms +
      rasterResult.stats.flattenedTransforms,
    fallbackTriggered:
      geometryResult.stats.fallbackTriggered +
      rasterResult.stats.fallbackTriggered,
  };

  return {
    optimizedSvg: rasterResult.optimizedSvg,
    stats: combinedStats,
    steps: buildSteps(combinedStats),
  };
}

// ===================== ADVANCED ENGINE =====================

async function runAdvancedOptimization(
  source: string,
  config: OptimizerConfig,
  stats: OptimizationStats,
  startTime: number,
  onProgress?: (percent: number) => void
): Promise<OptimizationOutcome> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "image/svg+xml");
  const precision = config.precision;

  if (doc.querySelector("parsererror"))
    throw new Error("optimizer.errors.parse");
  const originalSvg = doc.querySelector("svg");
  if (!originalSvg) throw new Error("optimizer.errors.invalidRoot");

  const { element: svg, cleanup } = adoptSvg(originalSvg);
  const occlusion = new OcclusionMask(OCCLUDER_SEGMENT_BUDGET);
  let scope: paper.PaperScope | null = null;

  try {
    const defs = detachDefs(svg);
    stripMetadataAndComments(svg);
    ensureViewBox(svg);
    normalizeAttributes(svg);
    bakeAncestorTransforms(svg);
    const viewport = deriveViewport(svg);
    config = scaleConfigToViewport(config, viewport);

    scope = createPaperScope(viewport);

    const shapeElements = collectShapeElements(svg);
    const imported: (ImportedShape & { isSolid: boolean })[] = [];

    const MIN_YIELD_MS = 250;
    let lastYieldTime = now();
    const maybeYield = async (progressValue?: number) => {
      const currentTime = now();
      if (currentTime - lastYieldTime >= MIN_YIELD_MS) {
        if (onProgress && typeof progressValue === "number") {
          onProgress(progressValue);
        }
        await yieldToMain();
        scope?.activate();
        lastYieldTime = now();
      }
    };

    // --- IMPORT PHASE ---
    for (let i = 0; i < shapeElements.length; i++) {
      const el = shapeElements[i];
      await maybeYield();

      if (!isVisuallyVisible(el)) {
        stats.invisibleElements++;
        stats.removedElements++;
        continue;
      }

      try {
        const path = importToPaper(scope, el);
        if (!path) {
          stats.degenerateElements++;
          stats.removedElements++;
          continue;
        }
        if (el.hasAttribute("transform")) stats.flattenedTransforms++;

        path.reduce({});

        const attrs = extractAttributes(el);
        const footprint = getPaintedFootprint(path, attrs);
        if (!Number.isFinite(footprint) || footprint < config.minArea) {
          stats.degenerateElements++;
          stats.removedElements++;
          path.remove();
          continue;
        }

        const originalD = el.hasAttribute("transform")
          ? path.pathData
          : el.getAttribute("d") || path.pathData;
        const { opacity, isSolid, strokeWidth } = getComputedOpacityAndSolidity(el);

        // BAKE OPACITY: This allows identical paths with different original styles 
        // to successfully group if their final visual opacity is the same.
        if (opacity < 0.99) {
          attrs.inheritable["opacity"] = opacity.toFixed(3);
          delete attrs.unique["opacity"];
          delete attrs.unique["fill-opacity"];
          delete attrs.inheritable["fill-opacity"];
        }

        imported.push({ path, attrs, originalD, isSolid, strokeWidth });
      } catch (e) {
        stats.degenerateElements++;
      }
    }

    if (onProgress) onProgress(25);

    // --- MERGE PHASE (Strict Adjacency) ---
    // Using the stable O(N) loop that generated the 130KB result.
    const mergedShapes = mergeHomogeneousShapes(imported, config, scope);
    
    const visibleShapes: ProcessedShape[] = [];
    const booleanCutsEnabled = config.enableBooleanCuts;
    const totalLayers = mergedShapes.length;

    // --- BOOLEAN PROCESSING PHASE ---
    for (let i = totalLayers - 1; i >= 0; i--) {
      const shape = mergedShapes[i];
      let finalPathData = "";
      let usedCut = false;

      const percent =
        25 + Math.floor(((totalLayers - i) / totalLayers) * 70);
      await maybeYield(percent);

      let working: paper.PathItem | null = shape.path.clone({ insert: false });

      if (booleanCutsEnabled && working && occlusion.covers(working.bounds)) {
        try {
          let cutResult = occlusion.cut(working);

          // Clean artifacts including thin slivers
          cutResult = cleanBooleanResult(
            cutResult,
            config.minFragmentArea,
            config.minFragmentThickness
          );

          if (cutResult.isEmpty()) {
            stats.hiddenLayers++;
            stats.removedElements++;
            working.remove();
            working = null;
          } else {
            const ratio = countSegments(cutResult) / (countSegments(working) || 1);

            if (ratio > config.maxComplexityRatio) {
              cutResult.remove();
              finalPathData = minifyPathString(shape.originalD, precision);
            } else {
              const cutString = minifyPathString(cutResult.pathData, precision);
              const origString = minifyPathString(shape.originalD, precision);

              if (byteSize(cutString) > byteSize(origString)) {
                cutResult.remove();
                finalPathData = origString;
              } else if (
                cutString.length >
                origString.length * config.fragmentationThreshold
              ) {
                cutResult.remove();
                working.remove();
                working = shape.path.clone({ insert: false });
                finalPathData = origString;
              } else {
                working.remove();
                working = cutResult;
                finalPathData = cutString;
                usedCut = true;
                stats.booleanUnions++;
              }
            }
          }
        } catch (e) {
          finalPathData = minifyPathString(shape.originalD, precision);
        }
      } else {
        finalPathData = minifyPathString(working.pathData, precision);
      }

      if (!working || working.isEmpty()) continue;

      // 5. Emit the shortest representation of the geometry we settled on.
      const emitted = bestPathString(
        working,
        usedCut ? null : shape.originalD,
        precision,
        config
      );
      if (!finalPathData || emitted.length < finalPathData.length) {
        finalPathData = emitted;
      }
      if (finalPathData.length < shape.originalD.length) stats.optimizedPaths++;

      const attrsCopy = {
        inheritable: { ...shape.attrs.inheritable },
        unique: { ...shape.attrs.unique },
      };

      const area = Math.abs(getPathArea(working));
      
      if (usedCut && shape.isSolid && config.enableTraps) {
        maybeApplyTrap(attrsCopy, area, 1, config);
      }

      visibleShapes.push({
        pathData: finalPathData,
        inheritable: attrsCopy.inheritable,
        unique: attrsCopy.unique,
      });

      // A shape with no interior covers only the ribbon its stroke paints,
      // which is never worth a union - and expanding a degenerate outline is
      // the pathological case for paper's expandStroke.
      if (
        booleanCutsEnabled &&
        shape.isSolid &&
        working &&
        getOutlineArea(working) > config.minArea
      ) {
        try {
          occlusion.add(
            buildOccluderPath(working, shape.attrs, shape.strokeWidth)
          );
        } catch {}
      }

      if (working) working.remove();
    }

    visibleShapes.reverse();
    // --- KEY FEATURE: OUTPUT GROUPING ---
    // This reduces file size by ~10-20% compared to flat path lists
    svg.innerHTML = reconstructSvg(visibleShapes);
    restoreDefs(svg, defs);
    cleanupIds(svg);

    const serializer = new XMLSerializer();
    const res = serializer.serializeToString(svg);

    stats.optimizedBytes = byteSize(res);
    stats.runtimeMs = now() - startTime;

    if (onProgress) onProgress(100);
    return { optimizedSvg: res, stats, steps: buildSteps(stats) };
  } finally {
    occlusion.dispose();
    if (scope) scope.project.clear();
    if (cleanup) cleanup();
  }
}

// ===================== HELPERS =====================

function mergeHomogeneousShapes(
  shapes: (ImportedShape & { isSolid: boolean })[],
  config: OptimizerConfig,
  scope: paper.PaperScope | null
): (ImportedShape & { isSolid: boolean })[] {
  if (!shapes.length || !scope) return shapes;
  const merged: (ImportedShape & { isSolid: boolean })[] = [];
  let idx = 0;
  
  while (idx < shapes.length) {
    const current = shapes[idx];
    const key = buildAttributeKey(current.attrs, current.isSolid, current.strokeWidth);
    
    const run: (ImportedShape & { isSolid: boolean })[] = [current];
    let j = idx + 1;
    while (
      j < shapes.length &&
      buildAttributeKey(shapes[j].attrs, shapes[j].isSolid, shapes[j].strokeWidth) === key
    ) {
      run.push(shapes[j]);
      j++;
    }

    if (run.length === 1) {
      merged.push(current);
      idx = j;
      continue;
    }

    const unioned = uniteRun(run, config);
    if (unioned) {
      merged.push(unioned);
    } else {
      merged.push(...run);
    }
    idx = j;
  }
  return merged;
}

function uniteRun(
  run: (ImportedShape & { isSolid: boolean })[],
  config: OptimizerConfig
): (ImportedShape & { isSolid: boolean }) | null {
  const precision = config.precision;
  
  const separateBytes = run.reduce(
    (sum, shape) => sum + byteSize(minifyPathString(shape.originalD, precision)),
    0
  );

  let acc = run[0].path.clone({ insert: false });
  let accString = minifyPathString(run[0].originalD, precision);

  for (let i = 1; i < run.length; i++) {
    const nextClone = run[i].path.clone({ insert: false });
    let unioned: paper.PathItem | null = null;
    try {
      unioned = acc.unite(nextClone, { insert: false }) as paper.PathItem;
    } catch {
      unioned = null;
    } finally {
      nextClone.remove();
    }

    if (!unioned || unioned.isEmpty()) {
      unioned?.remove();
      acc.remove();
      return null;
    }

    const unionString = minifyPathString(unioned.pathData, precision);
    const unionBytes = byteSize(unionString);
    
    if (unionBytes > separateBytes * 1.05) {
      unioned.remove();
      acc.remove();
      return null;
    }

    acc.remove();
    acc = unioned;
    accString = unionString;
  }

  return {
    ...run[0],
    path: acc,
    originalD: accString,
    isSolid: run[0].isSolid,
  };
}

const OCCLUDER_SEGMENT_BUDGET = 12000;

/**
 * Everything already painted above the shape being processed, kept as one
 * running union.
 *
 * The previous approach re-united the intersecting occluders from scratch for
 * every shape, which is quadratic: a 52-layer logo spent over a minute inside
 * those unions. One accumulating mask costs a single union and a single
 * subtraction per shape.
 *
 * Growth stops once the union gets expensive to subtract from. Under-occluding
 * only costs file size, while over-occluding would delete visible artwork.
 */
class OcclusionMask {
  private mask: paper.PathItem | null = null;
  private bounds: paper.Rectangle | null = null;
  private saturated = false;
  private readonly segmentBudget: number;

  constructor(segmentBudget: number) {
    this.segmentBudget = segmentBudget;
  }

  covers(bounds: paper.Rectangle): boolean {
    return Boolean(this.mask && this.bounds && this.bounds.intersects(bounds));
  }

  cut(shape: paper.PathItem): paper.PathItem {
    return shape.subtract(this.mask!, { insert: false }) as paper.PathItem;
  }

  add(path: paper.PathItem): void {
    if (this.saturated) {
      path.remove();
      return;
    }
    if (!this.mask) {
      this.mask = path;
    } else {
      const united = this.mask.unite(path, { insert: false }) as paper.PathItem;
      this.mask.remove();
      path.remove();
      this.mask = united;
    }
    this.bounds = this.mask.bounds.clone();
    if (countSegments(this.mask) > this.segmentBudget) this.saturated = true;
  }

  dispose(): void {
    this.mask?.remove();
    this.mask = null;
    this.bounds = null;
  }
}

function cleanBooleanResult(
  item: paper.PathItem,
  minArea: number,
  minThickness: number
): paper.PathItem {
  if (item.isEmpty()) return item;

  if (item.className === "Path") {
    const path = item as paper.Path;
    if (shouldDropPathFragment(path, minArea, minThickness)) {
      path.remove();
      return new paper.Path();
    }
    return item;
  }

  if (item.className === "CompoundPath") {
    const children = item.children || [];
    const childrenToKeep: paper.Item[] = [];

    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child instanceof paper.Path) {
         if (!shouldDropPathFragment(child, minArea, minThickness)) {
           childrenToKeep.push(child.clone({ insert: false }));
         }
      }
    }

    if (childrenToKeep.length === 0) {
      item.remove();
      return new paper.Path();
    }
    if (childrenToKeep.length === 1) {
      item.remove();
      return childrenToKeep[0] as paper.PathItem;
    }

    const newCompound = new paper.CompoundPath({
      children: childrenToKeep,
      insert: false,
    });
    item.remove();
    return newCompound;
  }

  return item;
}

/**
 * A boolean cut leaves hairline fragments along the edge it shared with the
 * mask. Those really are invisible, but what makes them invisible is their
 * thickness. Perimeter-to-area complexity is the wrong test: a long thin bar
 * and a ragged outline are both legitimate artwork. 2 * area / perimeter is
 * the fragment's mean thickness.
 */
function shouldDropPathFragment(
  path: paper.Path,
  minArea: number,
  minThickness: number
): boolean {
  const area = Math.abs(path.area);
  if (!Number.isFinite(area) || area < minArea) return true;
  const perimeter = Math.max(path.length, 1e-3);
  return (2 * area) / perimeter < minThickness;
}

function countSegments(item: paper.PathItem): number {
  if ("segments" in item && Array.isArray((item as any).segments)) {
    return (item as any).segments.length || 0;
  }
  if (item.children && item.children.length) {
    return item.children.reduce(
      (sum, child) => sum + countSegments(child as paper.PathItem),
      0
    );
  }
  return 0;
}

function buildAttributeKey(
  attrs: AttributeExtraction,
  isSolid: boolean,
  strokeWidth?: number
): string {
  const build = (rec: Record<string, string>) =>
    Object.entries(rec)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  const stroke = Number.isFinite(strokeWidth) ? strokeWidth!.toFixed(3) : "0";
  return `${build(attrs.inheritable)}|${build(attrs.unique)}|${isSolid ? 1 : 0}|${stroke}`;
}

/**
 * Area alone reports a horizontal rule, a <line>, or any open stroked path as
 * empty, so the degenerate-shape test used to delete every stroke-drawn
 * element. Add the band the stroke paints.
 */
function getPaintedFootprint(
  path: paper.PathItem,
  attrs: AttributeExtraction
): number {
  const area = getOutlineArea(path);
  const stroke = attrs.inheritable["stroke"] ?? attrs.unique["stroke"];
  if (!stroke || stroke === "none") return area;
  // A stroke with no stroke-width is one unit wide, not zero.
  const width = getStrokeWidth(attrs, 1);
  const length = (path as any).length as number | undefined;
  return width > 0 && Number.isFinite(length) ? area + length! * width : area;
}

function getStrokeWidth(
  attrs: AttributeExtraction,
  fallback?: number
): number {
  const raw =
    attrs.unique["stroke-width"] ||
    attrs.inheritable["stroke-width"] ||
    `${fallback ?? 0}`;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildOccluderPath(
  base: paper.PathItem,
  attrs: AttributeExtraction,
  strokeWidth?: number
): paper.PathItem {
  const stroke = attrs.inheritable["stroke"] ?? attrs.unique["stroke"];
  const width = getStrokeWidth(attrs, strokeWidth);
  const hasStrokeOcclusion =
    stroke && stroke !== "none" && !stroke.includes("url(") && width > 0.5;

  if (hasStrokeOcclusion) {
    const expanded = expandStrokeOutline(base, width);
    if (expanded) return expanded;
  }

  return base.clone({ insert: false });
}

function expandStrokeOutline(
  base: paper.PathItem,
  width: number
): paper.PathItem | null {
  if (width <= 0.01) return null;
  const clone = base.clone({ insert: false });
  try {
    (clone as any).strokeWidth = width;
    (clone as any).strokeColor = new paper.Color("black");
    if (typeof (clone as any).expandStroke === "function") {
      const expanded = (clone as any).expandStroke({
        insert: false,
        strokeWidth: width,
      }) as paper.PathItem;
      clone.remove();
      if (expanded && !expanded.isEmpty()) {
        return expanded;
      }
      expanded?.remove();
    }
  } catch {
    // ignore
  }
  clone.remove();
  return null;
}

function getComputedOpacityAndSolidity(el: Element): {
  opacity: number;
  isSolid: boolean;
  strokeWidth?: number;
  strokeOccluder: boolean;
} {
  const supportsComputed =
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function";

  if (supportsComputed) {
    let opacity = 1.0;
    let solid = true;
    let strokeWidth: number | undefined;
    let strokeOccluder = false;
    let current: Element | null = el;

    while (current && current.nodeType === 1 && current.tagName !== "svg") {
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity || "1") <= OPACITY_EPS
      ) {
        return { opacity: 0, isSolid: false, strokeOccluder: false };
      }

      const op = parseFloat(style.opacity || "1");
      if (!isNaN(op)) opacity *= op;

      const fillOpacity = parseFloat((style as any).fillOpacity ?? "1");
      if (!isNaN(fillOpacity)) opacity *= fillOpacity;

      const blend = (style as any).mixBlendMode;
      if (blend && blend !== "normal") solid = false;

      current = current.parentElement;
    }

    const style = window.getComputedStyle(el);
    const fill = style.fill || el.getAttribute("fill") || "";
    const stroke = style.stroke || el.getAttribute("stroke") || "";
    const strokeOpacity = parseFloat((style as any).strokeOpacity ?? "1");
    const strokeWidthAttr =
      parseFloat((style as any).strokeWidth ?? "") ||
      parseFloat(el.getAttribute("stroke-width") || "");
    strokeWidth = Number.isFinite(strokeWidthAttr) ? strokeWidthAttr : undefined;
    const hasSolidFill =
      fill &&
      fill !== "none" &&
      !/^url\(/i.test(fill) &&
      !fill.includes("rgba") &&
      !fill.includes("hsla");
    const hasSolidStroke =
      stroke &&
      stroke !== "none" &&
      !/^url\(/i.test(stroke) &&
      !stroke.includes("rgba") &&
      !stroke.includes("hsla") &&
      (strokeWidth || 0) > 0.5 &&
      strokeOpacity > 0.95;

    if (!hasSolidFill && !hasSolidStroke) {
      solid = false;
    }
    if (hasSolidStroke) {
      strokeOccluder = true;
    } else if (stroke && stroke !== "none") {
      solid = false;
    }

    return {
      opacity,
      isSolid: (solid || strokeOccluder) && opacity >= 0.99,
      strokeWidth,
      strokeOccluder,
    };
  }

  let totalOpacity = 1.0;
  let current: Element | null = el;
  const fill = el.getAttribute("fill");
  if (!fill || fill === "none") {
    return { opacity: 1, isSolid: false, strokeOccluder: false };
  }
  if (fill.includes("url(") || fill.includes("rgba") || fill.includes("hsla")) {
    return { opacity: 1, isSolid: false, strokeOccluder: false };
  }

  const strokeWidthAttr = parseFloat(el.getAttribute("stroke-width") || "0");
  const strokeAttr = el.getAttribute("stroke") || "";
  const strokeSolid = Boolean(
    strokeAttr &&
    strokeAttr !== "none" &&
    !strokeAttr.includes("url(") &&
    !strokeAttr.includes("rgba")
  );

  while (current && current.tagName !== "svg") {
    const opStr = current.getAttribute("opacity");
    if (opStr) {
      const val = parsePercentageOrFloat(opStr);
      if (!isNaN(val)) totalOpacity *= val;
    }
    const fillOpStr = current.getAttribute("fill-opacity");
    if (fillOpStr) {
      const val = parsePercentageOrFloat(fillOpStr);
      if (!isNaN(val)) totalOpacity *= val;
    }
    current = current.parentElement;
  }

  return {
    opacity: totalOpacity,
    isSolid: totalOpacity >= 0.99 || (strokeSolid && strokeWidthAttr > 0.5),
    strokeWidth: strokeSolid ? strokeWidthAttr : undefined,
    strokeOccluder: Boolean(strokeSolid && strokeWidthAttr > 0.5),
  };
}

function parsePercentageOrFloat(val: string): number {
    if (val.endsWith('%')) {
        return parseFloat(val) / 100.0;
    }
    return parseFloat(val);
}

function computeLocalPrecision(bounds: paper.Rectangle, base: number): number {
  const span = Math.max(bounds.width, bounds.height, 1e-3);
  const dynamic = Math.max(0, Math.ceil(2 - Math.log10(span)));
  return clamp(dynamic, 0.25, base);
}

function reorderClosedPath(path: paper.Path): void {
  const segments = [...path.segments];
  if (segments.length < 4) return;
  let best = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  segments.forEach((seg, idx) => {
    const p = seg.point;
    const score = Math.abs(p.x) + Math.abs(p.y);
    if (score < bestScore) {
      bestScore = score;
      best = idx;
    }
  });
  if (best === 0) return;
  const rotated = [...segments.slice(best), ...segments.slice(0, best)].map(
    (seg) =>
      new paper.Segment(seg.point.clone(), seg.handleIn.clone(), seg.handleOut.clone())
  );
  path.segments = rotated;
  path.closed = true;
}

/**
 * Drops anchors that sit on a straight run. Restarting the scan after every
 * removal made this quadratic - it dominated the runtime on paths with a few
 * thousand segments - and comparing only anchor positions also deleted anchors
 * in the middle of a curve, straightening it. One backward pass, and only
 * where both neighbouring curves are already straight.
 */
function removeCollinearSegments(path: paper.Path): void {
  const eps = 1e-4;
  for (let i = path.segments.length - 1; i >= 0; i--) {
    const segs = path.segments;
    if (segs.length < 3 || i >= segs.length) continue;
    const seg = segs[i];
    if (!seg.handleIn.isZero() || !seg.handleOut.isZero()) continue;
    const prev = segs[(i + segs.length - 1) % segs.length];
    const next = segs[(i + 1) % segs.length];
    if (!prev.handleOut.isZero() || !next.handleIn.isZero()) continue;
    const ab = seg.point.subtract(prev.point);
    const bc = next.point.subtract(seg.point);
    if (Math.abs(ab.cross(bc)) < eps) path.removeSegment(i);
  }
}

function runSafeOptimization(
  source: string,
  precision: number,
  stats: OptimizationStats,
  startTime: number
): OptimizationOutcome {
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG");

  stripMetadataAndComments(svg);
  ensureViewBox(svg);
  normalizeAttributes(svg);

  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current) {
    const el = current as Element;
    if (el.tagName.toLowerCase() === "path") {
      const d = el.getAttribute("d");
      if (d) {
        const mini = minifyPathString(d, precision);
        if (mini.length < d.length) {
          el.setAttribute("d", mini);
          stats.optimizedPaths++;
        }
      }
    }
    current = walker.nextNode();
  }

  cleanupIds(svg);
  const serializer = new XMLSerializer();
  const res = serializer.serializeToString(svg);
  stats.optimizedBytes = byteSize(res);
  stats.runtimeMs = now() - startTime;

  return { optimizedSvg: res, stats, steps: buildSteps(stats) };
}

function adoptSvg(svg: Element) {
  if (typeof document === "undefined")
    return { element: svg.cloneNode(true) as SVGSVGElement };
  let imported: SVGSVGElement;
  try {
    imported = document.importNode(svg, true) as SVGSVGElement;
  } catch {
    imported = svg.cloneNode(true) as SVGSVGElement;
  }
  if (document.body) {
    const host = document.createElement("div");
    host.style.cssText =
      "position:absolute; left:-9999px; top:-9999px; width:1px; height:1px; overflow:hidden;";
    host.append(imported);
    document.body.append(host);
    return { element: imported, cleanup: () => host.remove() };
  }
  return { element: imported };
}

const URL_REFERENCE = /url\(#([^)]+)\)/;

/**
 * Detaches <defs> subtrees before the tree is stripped and rebuilt. Gradients,
 * patterns, clip paths and masks live here; dropping them while a shape still
 * carries fill="url(#id)" leaves the shape unpainted.
 */
function detachDefs(svg: SVGElement): Element[] {
  const nodes = Array.from(svg.querySelectorAll("defs")).filter(
    (node) => !node.parentElement?.closest("defs")
  );
  nodes.forEach((node) => node.remove());
  return nodes;
}

function collectReferencedIds(svg: SVGElement): Set<string> {
  const used = new Set<string>();
  svg.querySelectorAll("*").forEach((el) =>
    Array.from(el.attributes).forEach((attr) => {
      const url = URL_REFERENCE.exec(attr.value);
      if (url) used.add(url[1]);
      if (attr.name.endsWith("href") && attr.value.startsWith("#")) {
        used.add(attr.value.slice(1));
      }
    })
  );
  return used;
}

/**
 * Puts the definitions back in front of the rebuilt body, then drops the ones
 * nothing refers to any more. Repeating until nothing changes also clears
 * definitions that were only kept alive by another dead definition.
 */
function restoreDefs(svg: SVGElement, defs: Element[]): void {
  for (let i = defs.length - 1; i >= 0; i--) {
    svg.insertBefore(defs[i], svg.firstChild);
  }
  for (;;) {
    const used = collectReferencedIds(svg);
    let removed = 0;
    svg.querySelectorAll("defs").forEach((node) =>
      Array.from(node.children).forEach((child) => {
        const id = child.getAttribute("id");
        if (!id || !used.has(id)) {
          child.remove();
          removed++;
        }
      })
    );
    if (!removed) break;
  }
  svg.querySelectorAll("defs").forEach((node) => {
    if (!node.children.length) node.remove();
  });
}

type Matrix = [number, number, number, number, number, number];

function readTransform(el: Element): Matrix | null {
  const list = (el as SVGGraphicsElement).transform?.baseVal;
  if (!list || list.numberOfItems === 0) return null;
  const m = list.consolidate()?.matrix;
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null;
}

function composeTransform(a: Matrix | null, b: Matrix | null): Matrix | null {
  if (!a) return b;
  if (!b) return a;
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Composes ancestor transforms into the shapes themselves. Shapes are imported
 * one element at a time below, and a lone element carries no knowledge of a
 * transform sitting on its parent <g>.
 */
function bakeAncestorTransforms(root: SVGElement): void {
  const walk = (el: Element, parent: Matrix | null) => {
    const combined = composeTransform(parent, readTransform(el));
    if (SHAPE_TAGS.has(el.tagName.toLowerCase())) {
      if (combined) {
        el.setAttribute(
          "transform",
          `matrix(${combined.map((v) => +v.toFixed(6)).join(",")})`
        );
      } else {
        el.removeAttribute("transform");
      }
      return;
    }
    el.removeAttribute("transform");
    Array.from(el.children).forEach((child) => walk(child, combined));
  };
  Array.from(root.children).forEach((child) => walk(child, null));
}

/**
 * The area and distance thresholds are authored against a 1024-unit canvas.
 * Rescale them to the document so a 24-unit icon is not simplified forty times
 * harder than a 1024-unit illustration.
 */
function scaleConfigToViewport(
  config: OptimizerConfig,
  viewport: ViewportSize
): OptimizerConfig {
  const k = Math.max(viewport.width, viewport.height, 1) / 1024;
  return {
    ...config,
    simplifyTolerance: config.simplifyTolerance * k,
    minArea: config.minArea * k * k,
    minFragmentArea: config.minFragmentArea * k * k,
    minFragmentThickness: config.minFragmentThickness * k,
    trapMin: config.trapMin * k,
    trapMax: config.trapMax * k,
  };
}

function ensureViewBox(svg: SVGElement) {
  const raw = svg.getAttribute("viewBox");
  if (raw && raw.split(/[\s,]+/).length === 4) return;
  const w = parseFloat(svg.getAttribute("width") || "1024") || 1024;
  const h = parseFloat(svg.getAttribute("height") || "1024") || 1024;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

function deriveViewport(svg: SVGElement): ViewportSize {
  const parts = (svg.getAttribute("viewBox") || "")
    .split(/[\s,]+/)
    .map(parseFloat)
    .filter(Number.isFinite);
  return parts.length === 4
    ? { width: parts[2], height: parts[3] }
    : { width: 1024, height: 1024 };
}

function createPaperScope(viewport: ViewportSize): paper.PaperScope {
  const scope = new paper.PaperScope();
  try {
    const w = Math.max(1, viewport.width);
    const h = Math.max(1, viewport.height);
    if (typeof OffscreenCanvas !== "undefined") {
      scope.setup(new OffscreenCanvas(w, h));
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      scope.setup(c);
    } else {
      throw new Error("No canvas");
    }
  } catch (e) {
    throw new Error("PaperSetupFailed");
  }
  scope.activate();
  return scope;
}

function importToPaper(
  scope: paper.PaperScope,
  element: Element
): paper.PathItem | null {
  const item = scope.project.importSVG(element as SVGElement, {
    expandShapes: true,
    applyMatrix: true,
    insert: false,
  });
  if (!item) return null;
  if (typeof (item as any).resolveCrossReferences === "function") {
    try {
      (item as any).resolveCrossReferences();
    } catch {
      // Ignore
    }
  }
  const flat = flattenItem(item, scope);
  item.remove();
  return flat;
}

function flattenItem(
  item: paper.Item,
  scope: paper.PaperScope
): paper.PathItem | null {
  if (item instanceof scope.Path || item instanceof scope.CompoundPath) {
    return item.clone({ insert: false });
  }
  if (item instanceof scope.Shape) {
    return item.toPath(true).clone({ insert: false });
  }
  if (item instanceof scope.Group) {
    const compound = new scope.CompoundPath({});
    (item.children || []).forEach((child) => {
      const asPath = flattenItem(child, scope);
      if (asPath) {
        if (asPath instanceof scope.CompoundPath) {
          (asPath as any).children.forEach((c: any) =>
            compound.addChild(c.clone({ insert: false }))
          );
        } else {
          compound.addChild(asPath.clone({ insert: false }));
        }
      }
    });
    return compound.children?.length ? compound : null;
  }
  return null;
}

/**
 * Painted extent, ignoring subpath winding. A compound path whose subpaths run
 * in opposite directions nets out to zero signed area while still being
 * perfectly visible, so the signed area cannot decide whether a shape is
 * degenerate.
 */
function getOutlineArea(item: paper.PathItem): number {
  if (item.children && item.children.length) {
    return item.children.reduce(
      (sum, child) => sum + getOutlineArea(child as paper.PathItem),
      0
    );
  }
  return Math.abs(getPathArea(item));
}

function getPathArea(item: paper.PathItem): number {
  return "area" in item ? (item as any).area || 0 : 0;
}

const MAX_AREA_DRIFT = 0.005;

/**
 * Shortest representation that still draws this shape.
 *
 * paper's simplify() stops honouring the requested tolerance once a path is
 * already near-minimal - a circle comes back 4% of its radius off whatever we
 * ask for - so a reshaped candidate has to prove it stayed close to the source
 * before it is allowed to win on length. The original "d" is a candidate too
 * whenever the geometry was not cut, which keeps a path from ever being
 * emitted larger than it arrived.
 */
function bestPathString(
  item: paper.PathItem,
  originalD: string | null,
  precision: number,
  config: OptimizerConfig
): string {
  let best = minifyPathString(item.pathData, precision);

  const reshaped = reshapeForSize(item, config);
  if (reshaped) {
    if (staysCloseTo(item, reshaped, config.simplifyTolerance)) {
      const candidate = minifyPathString(reshaped.pathData, precision);
      if (candidate.length < best.length) best = candidate;
    }
    reshaped.remove();
  }

  if (originalD) {
    const original = minifyPathString(originalD, precision);
    if (original.length < best.length) best = original;
  }
  return best;
}

/** True while the rebuilt outline still covers the same area and extent. */
function staysCloseTo(
  source: paper.PathItem,
  candidate: paper.PathItem,
  tolerance: number
): boolean {
  const sourceArea = Math.abs(getPathArea(source));
  const drift = Math.abs(sourceArea - Math.abs(getPathArea(candidate)));
  if (sourceArea > 0 && drift > sourceArea * MAX_AREA_DRIFT) return false;

  const a = source.bounds;
  const b = candidate.bounds;
  const budget = Math.max(tolerance, Math.max(a.width, a.height) * 0.001);
  return (
    Math.abs(a.x - b.x) <= budget &&
    Math.abs(a.y - b.y) <= budget &&
    Math.abs(a.width - b.width) <= budget &&
    Math.abs(a.height - b.height) <= budget
  );
}

function reshapeForSize(
  item: paper.PathItem,
  config: OptimizerConfig
): paper.PathItem | null {
  const clone = item.clone({ insert: false });
  if (clone instanceof paper.Path) {
    if (clone.closed && (clone.segments?.length || 0) > 3) {
      reorderClosedPath(clone);
    }
    removeCollinearSegments(clone);
  }
  clone.simplify(config.simplifyTolerance);
  if (clone.isEmpty()) {
    clone.remove();
    return null;
  }
  return clone;
}

function minifyPathString(
  pathData: string,
  precision: number,
  _bounds?: paper.Rectangle
): string {
  return new SVGPathCommander(pathData, { round: precision })
    .optimize()
    .toString();
}



function isVisuallyVisible(el: Element): boolean {
  const supportsComputed =
    typeof window !== "undefined" &&
    typeof window.getComputedStyle === "function";

  if (supportsComputed) {
    let current: Element | null = el;
    while (current && current.nodeType === 1) {
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        parseFloat(style.opacity || "1") <= OPACITY_EPS
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  if (el.getAttribute("display") === "none") return false;
  if (el.getAttribute("visibility") === "hidden") return false;
  return true;
}

function stripMetadataAndComments(svg: SVGElement) {
  const walker = svg.ownerDocument.createTreeWalker(
    svg,
    NodeFilter.SHOW_COMMENT
  );
  let n;
  while ((n = walker.nextNode())) n.parentNode?.removeChild(n);
  svg
    .querySelectorAll("metadata, title, desc, script")
    .forEach((e) => e.remove());
}

function normalizeAttributes(root: SVGElement) {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT
  );
  let curr: Node | null = walker.currentNode;
  while (curr) {
    const el = curr as Element;
    const isRoot = el === root;
    const style = el.getAttribute("style");
    if (style) {
      style.split(";").forEach((r) => {
        const [k, v] = r.split(":");
        if (k && v) el.setAttribute(k.trim(), v.trim());
      });
      el.removeAttribute("style");
    }
    Array.from(el.attributes).forEach((a) => {
      const name = a.name;
      if (isRoot && ["viewBox", "xmlns", "width", "height"].includes(name))
        return;
      if (name.startsWith("inkscape:") || name.startsWith("sodipodi:"))
        el.removeAttribute(name);
      else {
        const v = a.value.trim();
        if (isSingleNumber(v)) {
          const n = parseFloat(v);
          const fix = Number.isInteger(n)
            ? n.toString()
            : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
          if (fix !== v) el.setAttribute(name, fix);
        }
      }
    });
    curr = walker.nextNode();
  }
}

const SINGLE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * True only when the whole value is one number. List values such as
 * viewBox, points and stroke-dasharray must never be rounded as scalars.
 */
function isSingleNumber(value: string): boolean {
  return SINGLE_NUMBER.test(value);
}

// opacity composites a whole subtree, so it is the one groupable attribute
// that must not simply be copied down onto the shape.
const NON_INHERITED_ATTRS = new Set(["opacity"]);

/**
 * Resolves the paint attributes a shape inherits from its ancestors. The groups
 * carrying them are flattened away during the rebuild, so a path that relied on
 * <g fill="#..."> would otherwise come out unpainted.
 */
function inheritGroupableAttributes(
  el: Element,
  inheritable: Record<string, string>,
  unique: Record<string, string>
): void {
  for (let node = el.parentElement; node; node = node.parentElement) {
    GROUPABLE_ATTRS.forEach((name) => {
      if (NON_INHERITED_ATTRS.has(name)) return;
      if (inheritable[name] !== undefined || unique[name] !== undefined) return;
      const value = node!.getAttribute(name);
      if (value !== null) inheritable[name] = value;
    });
    if (node.tagName.toLowerCase() === "svg") break;
  }
}

function extractAttributes(el: Element): AttributeExtraction {
  const inheritable: Record<string, string> = {};
  const unique: Record<string, string> = {};
  Array.from(el.attributes).forEach((a) => {
    if (GEOMETRY_ATTRS.has(a.name)) return;
    if (GROUPABLE_ATTRS.has(a.name) && !UNIQUE_ATTRS.has(a.name))
      inheritable[a.name] = a.value;
    else unique[a.name] = a.value;
  });
  inheritGroupableAttributes(el, inheritable, unique);
  return { inheritable, unique };
}

function maybeApplyTrap(
  attrs: AttributeExtraction,
  area: number,
  scaleX: number,
  config: OptimizerConfig
): void {
  const fill = attrs.inheritable["fill"];
  const stroke = attrs.inheritable["stroke"];
  if (!fill || fill === "none" || (stroke && stroke !== "none")) return;
  if (area < config.minArea * 1.5) return;
  const trapWidth = computeTrapWidth(area, fill, scaleX, config);
  attrs.inheritable["stroke"] = fill;
  attrs.inheritable["stroke-width"] = trapWidth.toString();
}

function computeTrapWidth(
  area: number,
  fill: string,
  scaleX: number,
  config: OptimizerConfig
): number {
  const geometric = Math.sqrt(area) * 0.002;
  const pixel = 1.5 / Math.max(scaleX, 1);
  const luminance = relativeLuminance(fill);
  const multiplier = 0.75 + luminance * 0.25;
  const width = Math.max(geometric, pixel) * multiplier;
  return clamp(width, config.trapMin, config.trapMax);
}

function relativeLuminance(color: string): number {
  const hex = color.startsWith("#") ? color.slice(1) : null;
  if (!hex) return 0.7;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (expanded.length !== 6) return 0.7;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// --- OUTPUT GROUPING LOGIC ---
// This mimics the "Slow Version" structure (<g fill> vs repeated <path fill>)
// without altering geometry.
function reconstructSvg(shapes: ProcessedShape[]): string {
  if (!shapes.length) return "";

  // Repeated geometry is worth hoisting into <defs> and referencing with <use>.
  const freq = new Map<string, number>();
  shapes.forEach((s) => freq.set(s.pathData, (freq.get(s.pathData) || 0) + 1));

  const defs = new Map<string, string>();
  let defCounter = 0;
  freq.forEach((count, pathData) => {
    if (count > 1 && pathData.length > 50) defs.set(pathData, "s" + defCounter++);
  });

  const build = (rec: Record<string, string>) =>
    Object.entries(rec)
      .sort()
      .map(([k, v]) => k + '="' + v + '"')
      .join(" ");

  const render = (shape: ProcessedShape, extra: string) => {
    const attrs = [extra, build(shape.unique)].filter(Boolean).join(" ");
    const tail = (attrs ? " " + attrs : "") + " />";
    const defId = defs.get(shape.pathData);
    return defId
      ? '<use href="#' + defId + '"' + tail
      : '<path d="' + shape.pathData + '"' + tail;
  };

  const out: string[] = [];
  if (defs.size) {
    const parts = Array.from(defs.entries()).map(
      ([pathData, id]) => '<path id="' + id + '" d="' + pathData + '" />'
    );
    out.push("<defs>" + parts.join("") + "</defs>");
  }

  let key: string | null = null;
  let run: ProcessedShape[] = [];

  // A <g> only pays for itself once it holds more than one shape.
  const flush = () => {
    if (!run.length) return;
    if (key && run.length > 1) {
      out.push("<g " + key + ">" + run.map((s) => render(s, "")).join("") + "</g>");
    } else {
      out.push(run.map((s) => render(s, key ?? "")).join(""));
    }
    run = [];
  };

  for (const shape of shapes) {
    const shapeKey = build(shape.inheritable);
    if (shapeKey !== key) {
      flush();
      key = shapeKey || null;
    }
    run.push(shape);
  }
  flush();
  return out.join("");
}

function collectShapeElements(svg: SVGElement): Element[] {
  const arr: Element[] = [];
  const walker = svg.ownerDocument.createTreeWalker(
    svg,
    NodeFilter.SHOW_ELEMENT
  );
  let c;
  while ((c = walker.nextNode())) {
    if (SHAPE_TAGS.has((c as Element).tagName.toLowerCase()))
      arr.push(c as Element);
  }
  return arr;
}

function cleanupIds(svg: SVGElement) {
  const ids = new Map<string, Element>();
  svg.querySelectorAll("[id]").forEach((e) => ids.set(e.id, e));
  if (!ids.size) return;
  const used = new Set<string>();
  svg.querySelectorAll("*").forEach((e) =>
    Array.from(e.attributes).forEach((a) => {
      const m = URL_REFERENCE.exec(a.value);
      if (m) used.add(m[1]);
      if (a.name.endsWith("href") && a.value.startsWith("#"))
        used.add(a.value.slice(1));
    })
  );
  ids.forEach((e, id) => {
    if (!used.has(id)) e.removeAttribute("id");
  });
}

function buildSteps(stats: OptimizationStats): OptimizationStep[] {
  const s = [
    { key: "removedInvisible", count: stats.invisibleElements },
    { key: "removedDegenerate", count: stats.degenerateElements },
    { key: "gapRepaired", count: stats.gapRepairs },
    { key: "pathsOptimized", count: stats.optimizedPaths },
    { key: "booleanMerged", count: stats.booleanUnions },
    { key: "hiddenLayers", count: stats.hiddenLayers },
    { key: "flattenedTransforms", count: stats.flattenedTransforms },
    { key: "fallbackTriggered", count: stats.fallbackTriggered },
  ];
  return s.filter((x) => x.count > 0) as OptimizationStep[];
}

/**
 * Compressed size of a document, which is what actually ships.
 *
 * Raw and compressed size do not move together. Cutting a path against its
 * neighbours makes the string shorter but its coordinates more varied, and
 * varied coordinates compress worse: on the sample logo the raw-smaller output
 * cost 9% more over the wire. A guard that reads raw length is reading the
 * wrong number.
 */
async function compressedSize(text: string): Promise<number> {
  if (typeof CompressionStream === "undefined") return byteSize(text);
  try {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return (await new Response(stream).arrayBuffer()).byteLength;
  } catch {
    return byteSize(text);
  }
}

function byteSize(str: string) {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(str).length
    : str.length;
}
function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}