import paper from "paper/dist/paper-core";
import SVGPathCommander from "svg-path-commander";

const OPACITY_EPS = 5e-3;

type RasterOptimizerConfig = {
  rasterBase: number;
  rasterMin: number;
  occlusionThreshold: number;
  minArea: number;
  precision: number;
  simplifyTolerance: number;
  paperCanvasMax: number;
  pathImproveThreshold: number;
};

const DEFAULT_CONFIG: RasterOptimizerConfig = {
  rasterBase: 1024,
  rasterMin: 400,
  occlusionThreshold: 0.98,
  minArea: 16,
  precision: 1,
  simplifyTolerance: 0.15,
  paperCanvasMax: 2048,
  pathImproveThreshold: 0.95, // new path must be <= 95% of original length
};

export type RasterOptimizationOptions = Partial<
  Pick<
    RasterOptimizerConfig,
    | "precision"
    | "occlusionThreshold"
    | "rasterBase"
    | "rasterMin"
    | "simplifyTolerance"
  >
>;

export const DEFAULT_RASTER_OPTIONS: RasterOptimizationOptions = {
  precision: DEFAULT_CONFIG.precision,
  occlusionThreshold: DEFAULT_CONFIG.occlusionThreshold,
  rasterBase: DEFAULT_CONFIG.rasterBase,
  rasterMin: DEFAULT_CONFIG.rasterMin,
  simplifyTolerance: DEFAULT_CONFIG.simplifyTolerance,
};

function buildRasterConfig(
  options?: RasterOptimizationOptions
): RasterOptimizerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...options,
    precision: clamp(options?.precision ?? DEFAULT_CONFIG.precision, 0.25, 4),
    occlusionThreshold: clamp(
      options?.occlusionThreshold ?? DEFAULT_CONFIG.occlusionThreshold,
      0.5,
      1
    ),
    rasterBase: Math.max(options?.rasterBase ?? DEFAULT_CONFIG.rasterBase, 64),
    rasterMin: Math.max(options?.rasterMin ?? DEFAULT_CONFIG.rasterMin, 64),
    simplifyTolerance: clamp(
      options?.simplifyTolerance ?? DEFAULT_CONFIG.simplifyTolerance,
      0.05,
      4
    ),
  };
}

const SHAPE_TAGS = new Set([
  "path", "polygon", "polyline", "rect", "circle", "ellipse", "line",
]);

const GEOMETRY_ATTRS = new Set([
  "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "width", "height", "transform",
]);

const GROUPABLE_ATTRS = new Set([
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "color",
]);

const UNIQUE_ATTRS = new Set([
  "id", "class", "opacity", "fill-opacity", "stroke-opacity", "style",
  "visibility", "fill-rule",
]);

type ViewportSize = { x: number; y: number; width: number; height: number };
type AttributeExtraction = { inheritable: Record<string, string>; unique: Record<string, string> };
type ProcessedShape = { pathData: string; inheritable: Record<string, string>; unique: Record<string, string> };

export type OptimizationChangeKey =
  | "removedInvisible" | "removedDegenerate" | "gapRepaired" | "pathsOptimized"
  | "booleanMerged" | "hiddenLayers" | "flattenedTransforms" | "fallbackTriggered";

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

type VisibilityWindow = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisibilityResult = {
  ratio: number;
  window?: VisibilityWindow;
};

const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();

// 1. ASYNC HELPER
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

// ===================== PUBLIC API =====================

export async function optimizeSvgRaster(
  source: string,
  options?: RasterOptimizationOptions,
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
  const config = buildRasterConfig(options);

  try {
    if (onProgress) onProgress(5);

    const result = await runAsyncOptimization(
      trimmed,
      config,
      stats,
      startTime,
      onProgress
    );
    
    return result;
  } catch (err) {
    console.error("Optimization failed", err);
    throw err;
  }
}

// ===================== ASYNC LOGIC =====================

async function runAsyncOptimization(
  source: string,
  config: RasterOptimizerConfig,
  stats: OptimizationStats,
  startTime: number,
  onProgress?: (percent: number) => void
): Promise<OptimizationOutcome> {

  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "image/svg+xml");

  if (
    doc.documentElement.nodeName?.toLowerCase() === "parsererror" ||
    doc.querySelector("parsererror")
  ) {
    throw new Error("optimizer.errors.parse");
  }

  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("optimizer.errors.invalidRoot");

  // Definitions are set aside so the rebuilt body can reference them again,
  // and so shapes living inside them are not drawn as artwork.
  const defs = detachDefs(svg);

  // Drop comments, metadata, titles, desc, inkscape/sodipodi junk
  stripMetadataAndComments(svg);

  // Normalize styles, colors, numeric attributes
  normalizeAttributes(svg);
  bakeAncestorTransforms(svg);

  const viewport = deriveViewport(svg);
  const precision = config.precision;
  // The area threshold is written for a 1024-unit canvas.
  const minArea =
    config.minArea * (Math.max(viewport.width, viewport.height, 1) / 1024) ** 2;

  const scope = createPaperScope(viewport, config);
  const raster = new RasterOcclusionEngine(viewport, config);

  const shapeElements = collectShapeElements(svg);
  const processingOrder = [...shapeElements].reverse(); // top→bottom
  const kept: ProcessedShape[] = [];
  
  const totalItems = processingOrder.length;

  const MIN_YIELD_MS = 250;
  let lastYieldTime = now();
  const maybeYield = async (progressValue?: number) => {
    const currentTime = now();
    if (currentTime - lastYieldTime >= MIN_YIELD_MS) {
      if (onProgress && typeof progressValue === "number") {
        onProgress(progressValue);
      }
      await yieldToMain();
      scope.activate();
      lastYieldTime = now();
    }
  };

  try {
    for (let i = 0; i < totalItems; i++) {
      const element = processingOrder[i];

      const mappedProgress =
        totalItems > 0 ? 10 + Math.floor((i / totalItems) * 85) : 10;
      await maybeYield(mappedProgress);

      try {
        if (!isVisuallyVisible(element)) {
          stats.invisibleElements += 1;
          stats.removedElements += 1;
          continue;
        }

        const imported = importToPaper(scope, element);
        if (!imported) {
          // fallback: keep original path if available
          const d = element.getAttribute("d");
          if (element.tagName.toLowerCase() === "path" && d) {
            const attrs = extractAttributes(element);
            kept.push({
              pathData: d,
              inheritable: attrs.inheritable,
              unique: attrs.unique,
            });
          } else {
            stats.degenerateElements += 1;
            stats.removedElements += 1;
          }
          continue;
        }

        if (element.hasAttribute("transform")) {
          stats.flattenedTransforms += 1;
        }

        const attrs = extractAttributes(element);
        const area = getPaintedFootprint(imported, attrs);
        if (!Number.isFinite(area) || area < minArea) {
          stats.degenerateElements += 1;
          stats.removedElements += 1;
          imported.remove();
          continue;
        }

        const rasterPath = imported.pathData;
        const bounds = imported.bounds;
        const isOpaque = elementIsOpaque(element);
        const visibilityResult = raster.checkVisibilityAndMask(
          rasterPath,
          bounds,
          isOpaque,
          getEffectiveStrokeWidth(attrs)
        );
        const visibility = visibilityResult.ratio;

        if (visibility <= 1 - config.occlusionThreshold) {
          stats.hiddenLayers += 1;
          stats.removedElements += 1;
          imported.remove();
          continue;
        }

        // --- Path optimization race with “at least 5% better” guard ---

        // A transformed element's own "d" is in local space, so it is not a
        // stand-in for the imported geometry.
        const tag = element.tagName.toLowerCase();
        const originalPath =
          tag === "path" &&
          !element.hasAttribute("transform") &&
          element.getAttribute("d")
            ? element.getAttribute("d")!
            : imported.pathData;
        const minifiedOriginal = minifyPathString(originalPath, precision);

        let optimizationSource: paper.PathItem = imported;
        let baselineString = minifiedOriginal;
        let clipped: paper.PathItem | null = null;

        if (
          visibility < 0.995 &&
          visibilityResult.window &&
          getEffectiveStrokeWidth(attrs) === 0
        ) {
          clipped = intersectWithWindow(imported, visibilityResult.window, scope);
          if (clipped && !clipped.isEmpty()) {
            const clippedString = minifyPathString(clipped.pathData, precision);
            if (byteSize(clippedString) <= byteSize(minifiedOriginal)) {
              optimizationSource = clipped;
              baselineString = clippedString;
            } else {
              clipped.remove();
              clipped = null;
            }
          } else if (clipped) {
            clipped.remove();
            clipped = null;
          }
        }

        const reshaped = reshapeForSize(optimizationSource, config);
        const reshapedString = reshaped
          ? minifyPathString(reshaped.pathData, precision)
          : null;
        reshaped?.remove();
        const stringOptimized = minifyPathString(baselineString, precision);
        const candidate =
          reshapedString && reshapedString.length < stringOptimized.length
            ? reshapedString
            : stringOptimized;

        let bestPath = baselineString;
        if (
          candidate.length <
          baselineString.length * config.pathImproveThreshold
        ) {
          bestPath = candidate;
          stats.optimizedPaths += 1;
        }

        kept.push({
          pathData: bestPath,
          inheritable: attrs.inheritable,
          unique: attrs.unique,
        });

        clipped?.remove();
        imported.remove();
      } catch {
        // shape-level failure: keep unoptimized <path> if possible
        const d = element.getAttribute("d");
        if (element.tagName.toLowerCase() === "path" && d) {
          const attrs = extractAttributes(element);
          kept.push({
            pathData: d,
            inheritable: attrs.inheritable,
            unique: attrs.unique,
          });
        } else {
          stats.degenerateElements += 1;
          stats.removedElements += 1;
        }
      }
    }
  } finally {
    scope.project.clear();
  }

  if (onProgress) onProgress(98);

  // Render bottom→top
  kept.reverse();

  // Replace SVG content with flat path-only structure
  svg.innerHTML = reconstructSvg(kept);
  restoreDefs(svg, defs);

  // Cleanup IDs & shorten remaining ones
  cleanupIds(svg);

  const serializer = new XMLSerializer();
  const optimizedSvg = serializer.serializeToString(svg);
  stats.optimizedBytes = byteSize(optimizedSvg);
  stats.runtimeMs = now() - startTime;

  if (onProgress) onProgress(100);

  const steps = buildSteps(stats);
  return { optimizedSvg, stats, steps };
}

// ===================== COLLECTION & STEPS =====================

function collectShapeElements(svg: SVGElement): Element[] {
  const elements: Element[] = [];
  const doc = svg.ownerDocument;
  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current) {
    const element = current as Element;
    if (SHAPE_TAGS.has(element.tagName.toLowerCase())) {
      elements.push(element);
    }
    current = walker.nextNode();
  }
  return elements;
}

function buildSteps(stats: OptimizationStats): OptimizationStep[] {
  const entries: OptimizationStep[] = [
    { key: "removedInvisible", count: stats.invisibleElements },
    { key: "removedDegenerate", count: stats.degenerateElements },
    { key: "gapRepaired", count: stats.gapRepairs },
    { key: "pathsOptimized", count: stats.optimizedPaths },
    { key: "booleanMerged", count: stats.booleanUnions },
    { key: "hiddenLayers", count: stats.hiddenLayers },
    { key: "flattenedTransforms", count: stats.flattenedTransforms },
  ];
  return entries.filter((entry) => entry.count > 0);
}

// ===================== PAPER SETUP =====================

function createPaperScope(
  viewport: ViewportSize,
  config: RasterOptimizerConfig
): paper.PaperScope {
  const width = clamp(Math.ceil(viewport.width) || 1, 8, config.paperCanvasMax);
  const height = clamp(
    Math.ceil(viewport.height) || 1,
    8,
    config.paperCanvasMax,
  );
  const scope = new paper.PaperScope();
  const canvas = createScratchCanvas(width, height);
  scope.setup(canvas);
  scope.activate();
  return scope;
}

function createScratchCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(safeWidth, safeHeight);
  }

  if (
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    return canvas;
  }

  throw new Error("optimizer.errors.environment");
}

// ===================== VIEWPORT & ATTR NORMALIZATION =====================
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

function deriveViewport(svg: SVGElement): ViewportSize {
  const viewBoxAttr = svg.getAttribute("viewBox");
  if (viewBoxAttr) {
    const parts = viewBoxAttr
      .split(/[,\s]+/)
      .map((token) => Number.parseFloat(token))
      .filter((value) => Number.isFinite(value));
    if (parts.length === 4) {
      return {
        x: parts[0],
        y: parts[1],
        width: Math.max(parts[2], 1),
        height: Math.max(parts[3], 1),
      };
    }
  }

  const widthAttr = toNumber(svg.getAttribute("width")) ?? 1024;
  const heightAttr = toNumber(svg.getAttribute("height")) ?? 1024;
  return {
    x: 0,
    y: 0,
    width: Math.max(widthAttr, 1),
    height: Math.max(heightAttr, 1),
  };
}

function stripMetadataAndComments(svg: SVGElement): void {
  const doc = svg.ownerDocument;

  // Remove comments
  const commentWalker = doc.createTreeWalker(svg, NodeFilter.SHOW_COMMENT);
  const toRemove: ChildNode[] = [];
  let cNode: Node | null = commentWalker.currentNode;
  while (cNode) {
    toRemove.push(cNode as ChildNode);
    cNode = commentWalker.nextNode();
  }
  toRemove.forEach((n) => n.parentNode?.removeChild(n));

  // Remove metadata / title / desc / editor junk
  const removeTags = new Set(["metadata", "title", "desc"]);
  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  const elementsToRemove: Element[] = [];

  let current: Node | null = walker.currentNode;
  while (current) {
    const el = current as Element;
    const local = el.localName.toLowerCase();
    const prefix = el.prefix || "";

    if (
      removeTags.has(local) ||
      prefix === "sodipodi" ||
      prefix === "inkscape"
    ) {
      elementsToRemove.push(el);
    }
    current = walker.nextNode();
  }

  elementsToRemove.forEach((el) => el.remove());
}

function normalizeAttributes(root: SVGElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current) {
    const node = current as Element;

    // explode style
    const style = node.getAttribute("style");
    if (style) {
      style.split(";").forEach((rule) => {
        const [rawName, rawValue] = rule.split(":");
        if (!rawName || rawValue === undefined) return;
        node.setAttribute(rawName.trim(), rawValue.trim());
      });
      node.removeAttribute("style");
    }

    // remove inkscape/sodipodi attributes and namespaces
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name;
      if (
        name.startsWith("inkscape:") ||
        name.startsWith("sodipodi:") ||
        name.startsWith("xmlns:inkscape") ||
        name.startsWith("xmlns:sodipodi")
      ) {
        node.removeAttribute(name);
      }
    });

    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      const normalizedName = attr.name;
      let value = attr.value.trim();

      if (value.startsWith("#")) {
        value = minifyHex(value);
      } else if (!value.includes("url") && isFiniteNumber(value)) {
        value = normalizeNumber(value);
      }

      if (normalizedName.includes("opacity")) {
        const numeric = Number.parseFloat(value);
        if (Number.isFinite(numeric) && numeric >= 0.99) {
          node.removeAttribute(attr.name);
          continue;
        }
      }

      if (attr.value !== value) {
        node.setAttribute(attr.name, value);
      }
    }

    current = walker.nextNode();
  }
}

function minifyHex(value: string): string {
  const normalized = value.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const r1 = normalized[1];
    const r2 = normalized[2];
    const g1 = normalized[3];
    const g2 = normalized[4];
    const b1 = normalized[5];
    const b2 = normalized[6];
    if (r1 === r2 && g1 === g2 && b1 === b2) {
      return `#${r1}${g1}${b1}`;
    }
  }
  return normalized;
}

function normalizeNumber(value: string): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) {
    return value;
  }
  if (Number.isInteger(num)) {
    return num.toString();
  }
  return Number(num.toFixed(3)).toString();
}

const SINGLE_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * True only when the whole value is one number. List values such as
 * viewBox, points and stroke-dasharray must never be rounded as scalars.
 */
function isFiniteNumber(value: string): boolean {
  return SINGLE_NUMBER.test(value);
}

// ===================== PAPER IMPORT & PATH OPS =====================

function importToPaper(
  scope: paper.PaperScope,
  element: Element,
): paper.PathItem | null {
  try {
    const clone = element.cloneNode(true) as SVGElement;
    const item = scope.project.importSVG(clone, {
      expandShapes: true,
      applyMatrix: true,
      insert: false,
    });
    if (!item) return null;

    const flattened = flattenItem(item, scope);
    item.remove();

    if (!flattened) return null;

    if (flattened instanceof scope.CompoundPath) {
      try {
        (flattened as any).reorient(true, true);
      } catch {
        // ignore bad compound paths
      }
    }

    if (!Number.isFinite((flattened as any).area)) {
      flattened.remove();
      return null;
    }

    return flattened;
  } catch {
    return null;
  }
}

function flattenItem(
  item: paper.Item,
  scope: paper.PaperScope,
): paper.PathItem | null {
  if (item instanceof scope.Path || item instanceof scope.CompoundPath) {
    return item.clone({ insert: false });
  }

  if (item instanceof scope.Shape) {
    const path = item.toPath(true);
    return path.clone({ insert: false });
  }

  if (item instanceof scope.Group) {
    // safer: flatten whole group into one compound without boolean ops
    const compound = new scope.CompoundPath({});
    (item.children || []).forEach((child) => {
      const asPath = flattenItem(child, scope);
      if (asPath) {
        if (asPath instanceof scope.CompoundPath) {
          (asPath as any).children.forEach((c: any) =>
            compound.addChild(c.clone({ insert: false })),
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
  const width = getEffectiveStrokeWidth(attrs);
  const length = (path as any).length as number | undefined;
  return width > 0 && Number.isFinite(length) ? area + length! * width : area;
}

/** Width of the band this shape's stroke paints; 0 when it has no stroke. */
function getEffectiveStrokeWidth(attrs: AttributeExtraction): number {
  const stroke = attrs.inheritable["stroke"] ?? attrs.unique["stroke"];
  if (!stroke || stroke === "none" || stroke === "transparent") return 0;
  const width = Number.parseFloat(
    attrs.unique["stroke-width"] ?? attrs.inheritable["stroke-width"] ?? "1"
  );
  return Number.isFinite(width) && width > 0 ? width : 0;
}

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
  if ("area" in item && typeof (item as any).area === "number") {
    return (item as any).area;
  }
  return 0;
}

const MAX_AREA_DRIFT = 0.005;

/**
 * paper's simplify() stops honouring the requested tolerance once a path is
 * near-minimal - a circle comes back several percent of its radius off
 * whatever we ask for - so a refitted path has to prove it stayed close to the
 * source before it is allowed to win on length.
 */
function reshapeForSize(
  item: paper.PathItem,
  config: RasterOptimizerConfig
): paper.PathItem | null {
  const clone = item.clone({ insert: false });
  clone.simplify(config.simplifyTolerance);
  if (clone.isEmpty() || !staysCloseTo(item, clone, config.simplifyTolerance)) {
    clone.remove();
    return null;
  }
  return clone;
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

function minifyPathString(pathData: string, precision: number): string {
  return new SVGPathCommander(pathData, { round: precision })
    .optimize()
    .toString();
}

function intersectWithWindow(
  source: paper.PathItem,
  window: VisibilityWindow,
  scope: paper.PaperScope
): paper.PathItem | null {
  try {
    const rect = new scope.Path.Rectangle(
      new scope.Rectangle(window.x, window.y, window.width, window.height)
    );
    (rect as any).closed = true;
    (rect as any).insert = false;
    const clone = source.clone({ insert: false });
    const clipped = clone.intersect(rect, { insert: false }) as paper.PathItem;
    rect.remove();
    clone.remove();
    if (clipped && !clipped.isEmpty()) {
      return clipped;
    }
    clipped?.remove();
  } catch {
    // Ignore clipping failures and continue with unmodified geometry
  }
  return null;
}

// ===================== VISIBILITY & ATTR LOGIC =====================

function elementIsOpaque(element: Element): boolean {
  const styles = computeEffectiveStyles(element);
  if (styles.displayNone || styles.opacity < 0.98) return false;

  const fillColor = styles.fill;
  const strokeColor = styles.stroke;
  const fillSolid =
    typeof fillColor === "string" &&
    fillColor !== "none" &&
    !isComplexPaint(fillColor) &&
    styles.fillOpacity >= 0.98;
  const strokeSolid =
    typeof strokeColor === "string" &&
    strokeColor !== "none" &&
    !isComplexPaint(strokeColor) &&
    styles.strokeOpacity >= 0.98;

  return (fillSolid || strokeSolid) && styles.opacity >= 0.98;
}

function isVisuallyVisible(element: Element): boolean {
  const styles = computeEffectiveStyles(element);
  if (styles.displayNone || styles.visibilityHidden) return false;
  if (styles.opacity <= OPACITY_EPS) return false;

  const fillNone =
    !styles.fill || styles.fill === "none" || styles.fill === "transparent";
  const strokeNone =
    !styles.stroke || styles.stroke === "none" || styles.stroke === "transparent";

  return !(fillNone && strokeNone);
}

type EffectiveStyles = {
  displayNone: boolean;
  visibilityHidden: boolean;
  opacity: number;
  fill: string | null;
  stroke: string | null;
  fillOpacity: number;
  strokeOpacity: number;
};

function computeEffectiveStyles(element: Element): EffectiveStyles {
  let current: Element | null = element;
  let displayNone = false;
  let visibilityHidden = false;
  let opacity = 1;
  let fill: string | null = null;
  let stroke: string | null = null;
  let fillOpacity = 1;
  let strokeOpacity = 1;

  while (current && current.nodeType === 1) {
    if (!displayNone) {
      const display = current.getAttribute("display");
      if (display && display.trim() === "none") {
        displayNone = true;
      }
    }

    if (!visibilityHidden) {
      const visibility = current.getAttribute("visibility");
      if (visibility && visibility.trim() === "hidden") {
        visibilityHidden = true;
      }
    }

    const opAttr = current.getAttribute("opacity");
    if (opAttr) {
      const val = Number.parseFloat(opAttr);
      if (!Number.isNaN(val)) {
        opacity *= val;
      }
    }

    if (!fill) {
      const fillAttr = current.getAttribute("fill");
      if (fillAttr && fillAttr !== "inherit") {
        fill = fillAttr;
      }
    }

    if (!stroke) {
      const strokeAttr = current.getAttribute("stroke");
      if (strokeAttr && strokeAttr !== "inherit") {
        stroke = strokeAttr;
      }
    }

    const fillOp = current.getAttribute("fill-opacity");
    if (fillOp) {
      const val = Number.parseFloat(fillOp);
      if (!Number.isNaN(val)) {
        fillOpacity *= val;
      }
    }

    const strokeOp = current.getAttribute("stroke-opacity");
    if (strokeOp) {
      const val = Number.parseFloat(strokeOp);
      if (!Number.isNaN(val)) {
        strokeOpacity *= val;
      }
    }

    current = current.parentElement;
  }

  const clamp01 = (val: number) => Math.min(Math.max(val, 0), 1);

  return {
    displayNone,
    visibilityHidden,
    opacity: clamp01(opacity),
    fill,
    stroke,
    fillOpacity: clamp01(fillOpacity),
    strokeOpacity: clamp01(strokeOpacity),
  };
}

function isComplexPaint(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("url(") ||
    normalized.includes("rgba(") ||
    normalized.includes("hsla(")
  );
}

function normalizeOpacity(value: number): string {
  return Number(value.toFixed(3)).toString();
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

function extractAttributes(element: Element): AttributeExtraction {
  const inheritable: Record<string, string> = {};
  const unique: Record<string, string> = {};

  Array.from(element.attributes).forEach((attr) => {
    const name = attr.name;
    if (GEOMETRY_ATTRS.has(name)) return;

    if (GROUPABLE_ATTRS.has(name) && !UNIQUE_ATTRS.has(name)) {
      inheritable[name] = attr.value;
    } else {
      unique[name] = attr.value;
    }
  });
  inheritGroupableAttributes(element, inheritable, unique);

  const styles = computeEffectiveStyles(element);
  if (!inheritable["fill"] && styles.fill && styles.fill !== "none") {
    inheritable["fill"] = styles.fill;
  }
  if (!inheritable["stroke"] && styles.stroke && styles.stroke !== "none") {
    inheritable["stroke"] = styles.stroke;
  }
  if (
    !inheritable["fill-opacity"] &&
    styles.fillOpacity < 0.999 &&
    styles.fillOpacity > OPACITY_EPS
  ) {
    inheritable["fill-opacity"] = normalizeOpacity(styles.fillOpacity);
  }
  if (
    !inheritable["stroke-opacity"] &&
    styles.strokeOpacity < 0.999 &&
    styles.strokeOpacity > OPACITY_EPS
  ) {
    inheritable["stroke-opacity"] = normalizeOpacity(styles.strokeOpacity);
  }
  if (styles.opacity < 0.999 && styles.opacity > OPACITY_EPS) {
    unique["opacity"] = normalizeOpacity(styles.opacity);
  } else {
    delete unique["opacity"];
  }

  return { inheritable, unique };
}

// ===================== RECONSTRUCTION =====================

function reconstructSvg(shapes: ProcessedShape[]): string {
  if (!shapes.length) return "";

  const build = (rec: Record<string, string>) =>
    Object.entries(rec)
      .sort()
      .map(([k, v]) => k + '="' + v + '"')
      .join(" ");

  const render = (shape: ProcessedShape, extra: string) => {
    const attrs = [extra, build(shape.unique)].filter(Boolean).join(" ");
    return '<path d="' + shape.pathData + '"' + (attrs ? " " + attrs : "") + " />";
  };

  const out: string[] = [];
  let key: string | null = null;
  let run: ProcessedShape[] = [];

  // A <g> only pays for itself once it holds more than one path.
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

// ===================== RASTER OCCLUSION ENGINE =====================

class RasterOcclusionEngine {
  private canvas: OffscreenCanvas | HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private scratch: OffscreenCanvas | HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private width: number;
  private height: number;
  public readonly scaleX: number;
  private readonly scaleY: number;
  private readonly originX: number;
  private readonly originY: number;

  constructor(viewport: ViewportSize, config: RasterOptimizerConfig) {
    const aspect = viewport.width / viewport.height;
    const base = config.rasterBase;

    if (aspect >= 1) {
      this.width = Math.max(config.rasterMin, base);
      this.height = Math.max(
        config.rasterMin,
        Math.round(base / Math.max(aspect, 0.01)),
      );
    } else {
      this.width = Math.max(
        config.rasterMin,
        Math.round(base * Math.max(aspect, 0.01)),
      );
      this.height = Math.max(config.rasterMin, base);
    }

    this.canvas = createScratchCanvas(this.width, this.height);
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("optimizer.errors.environment");
    }
    this.ctx = ctx;

    this.scratch = createScratchCanvas(this.width, this.height);
    const scratchCtx = this.scratch.getContext("2d", {
      willReadFrequently: true,
    });
    if (!scratchCtx) {
      throw new Error("optimizer.errors.environment");
    }
    this.scratchCtx = scratchCtx;

    this.scaleX = this.width / viewport.width;
    this.scaleY = this.height / viewport.height;
    this.originX = viewport.x;
    this.originY = viewport.y;

    this.clearAll(this.ctx);
    this.clearAll(this.scratchCtx);
  }

  private clearAll(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ) {
    // Clear in device pixels
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.setTransform(
      this.scaleX,
      0,
      0,
      this.scaleY,
      -this.originX * this.scaleX,
      -this.originY * this.scaleY
    );
  }

  checkVisibilityAndMask(
    pathData: string,
    bounds: paper.Rectangle,
    isOpaque: boolean,
    strokeWidth = 0
  ): VisibilityResult {
    let path: Path2D;
    try {
      path = new Path2D(pathData);
    } catch {
      // If path parsing fails, assume fully visible and don't update mask
      return { ratio: 1 };
    }

    // 1. Draw shape into scratch, with the stroke band it really paints
    const line = Math.max(strokeWidth, 1 / Math.max(this.scaleX, this.scaleY));
    this.clearAll(this.scratchCtx);
    this.scratchCtx.fillStyle = "#ff0000";
    this.scratchCtx.strokeStyle = "#ff0000";
    this.scratchCtx.lineWidth = line;
    this.scratchCtx.fill(path);
    this.scratchCtx.stroke(path);

    // 2. Compute pixel bounds
    const pad =
      Math.ceil((line / 2) * Math.max(this.scaleX, this.scaleY)) + 2;
    const pxX = Math.floor((bounds.x - this.originX) * this.scaleX) - pad;
    const pxY = Math.floor((bounds.y - this.originY) * this.scaleY) - pad;
    const pxW = Math.ceil(bounds.width * this.scaleX) + pad * 2;
    const pxH = Math.ceil(bounds.height * this.scaleY) + pad * 2;

    const sx = clamp(pxX, 0, this.width - 1);
    const sy = clamp(pxY, 0, this.height - 1);
    const sw = clamp(pxW, 1, this.width - sx);
    const sh = clamp(pxH, 1, this.height - sy);

    let shapeData: Uint8ClampedArray;
    let maskData: Uint8ClampedArray;

    try {
      shapeData = this.scratchCtx.getImageData(sx, sy, sw, sh).data;
      maskData = this.ctx.getImageData(sx, sy, sw, sh).data;
    } catch {
      // If we can't read pixels, treat as fully visible and don't alter mask
      return { ratio: 1 };
    }

    // Scan every pixel in the shape's box. The pixels are already in memory,
    // so the loop is cheap next to the getImageData that fetched them, and
    // both the visible ratio and the window below come out exact. A sampled
    // window under-reports the visible extent, and anything outside it is then
    // clipped away.
    let total = 0;
    let visible = 0;
    let minPx = Number.POSITIVE_INFINITY;
    let minPy = Number.POSITIVE_INFINITY;
    let maxPx = -1;
    let maxPy = -1;
    for (let row = 0; row < sh; row++) {
      for (let col = 0; col < sw; col++) {
        const i = (row * sw + col) * 4 + 3;
        if (shapeData[i] <= 50) continue;
        total += 1;
        if (maskData[i] < 240) {
          visible += 1;
          const px = sx + col;
          const py = sy + row;
          if (px < minPx) minPx = px;
          if (py < minPy) minPy = py;
          if (px > maxPx) maxPx = px;
          if (py > maxPy) maxPy = py;
        }
      }
    }

    // Nothing to measure is a failed measurement, not an invisible shape.
    if (!total) {
      return { ratio: 1 };
    }

    const ratio = visible / total;
    const window =
      visible > 0 && Number.isFinite(minPx) && Number.isFinite(minPy)
        ? {
            x: this.originX + (minPx - 1) / this.scaleX,
            y: this.originY + (minPy - 1) / this.scaleY,
            width: Math.max((maxPx - minPx + 3) / this.scaleX, 0),
            height: Math.max((maxPy - minPy + 3) / this.scaleY, 0),
          }
        : undefined;

    if (isOpaque && ratio > 0.02) {
      this.ctx.fillStyle = "#000";
      this.ctx.strokeStyle = "#000";
      this.ctx.lineWidth = line;
      this.ctx.fill(path);
      this.ctx.stroke(path);
    }

    return { ratio, window };
  }
}

// ===================== ID CLEANUP & SHORTENING =====================

function cleanupIds(svg: SVGElement): void {
  const doc = svg.ownerDocument;
  const idElements: Map<string, Element> = new Map();

  // 1. Collect elements with ids
  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;
  while (current) {
    const el = current as Element;
    const id = el.getAttribute("id");
    if (id) {
      idElements.set(id, el);
    }
    current = walker.nextNode();
  }

  if (!idElements.size) return;

  // 2. Collect used ids (url(#id), href="#id", xlink:href="#id")
  const used = new Set<string>();
  const walker2 = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  current = walker2.currentNode;
  while (current) {
    const el = current as Element;
    Array.from(el.attributes).forEach((attr) => {
      const val = attr.value;
      // url(#id)
      const urlRegex = /url\(#([^)]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = urlRegex.exec(val))) {
        used.add(m[1]);
      }

      // href / xlink:href
      if ((attr.name === "href" || attr.name === "xlink:href") && val[0] === "#") {
        used.add(val.slice(1));
      }
    });
    current = walker2.nextNode();
  }

  // 3. Remove unused ids
  for (const [id, el] of idElements.entries()) {
    if (!used.has(id)) {
      el.removeAttribute("id");
      idElements.delete(id);
    }
  }

  if (!idElements.size) return;

  // 4. Shorten remaining ids
  const remainingOldIds = Array.from(idElements.keys());
  const mapping = new Map<string, string>();
  let counter = 0;

  const existingNames = new Set<string>(remainingOldIds);

  const nextId = (): string => {
    while (true) {
      const s = encodeId(counter++);
      if (!existingNames.has(s)) return s;
    }
  };

  for (const oldId of remainingOldIds) {
    mapping.set(oldId, nextId());
  }

  // 5. Apply new ids
  for (const [oldId, el] of idElements.entries()) {
    const newId = mapping.get(oldId)!;
    el.setAttribute("id", newId);
  }

  // 6. Rewrite references
  const walker3 = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  current = walker3.currentNode;
  while (current) {
    const el = current as Element;
    Array.from(el.attributes).forEach((attr) => {
      let val = attr.value;
      let changed = false;

      // url(#id)
      val = val.replace(/url\(#([^)]+)\)/g, (_, id: string) => {
        if (mapping.has(id)) {
          changed = true;
          return `url(#${mapping.get(id)})`;
        }
        return `url(#${id})`;
      });

      // href / xlink:href
      if ((attr.name === "href" || attr.name === "xlink:href") && val[0] === "#") {
        const id = val.slice(1);
        if (mapping.has(id)) {
          val = `#${mapping.get(id)}`;
          changed = true;
        }
      }

      if (changed) {
        el.setAttribute(attr.name, val);
      }
    });
    current = walker3.nextNode();
  }
}

function encodeId(n: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const base = alphabet.length;
  let s = "";
  do {
    s = alphabet[n % base] + s;
    n = Math.floor(n / base);
  } while (n > 0);
  return s;
}

// ===================== MISC UTIL =====================

function toNumber(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function byteSize(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).length;
  }
  return value.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
