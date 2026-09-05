import paper from "paper/dist/paper-core";
import SVGPathCommander from "svg-path-commander";

// ===================== TYPES =====================

export type ScissorOptions = {
  resolution?: number;    
  sensitivity?: number;   
  debug?: boolean;
};

type OptimizationStats = {
  originalSize: number;
  finalSize: number;
  shapesProcessed: number;
  shapesCulled: number;
  shapesClipped: number;
  shapesDeduped: number;
  runtimeMs: number;
};

type ProcessedShape = {
  pathData: string;
  fill: string | null;
  fillOpacity: number;
  fillRule: string; 
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  strokeLinecap: string;
  strokeLinejoin: string;
  opacity: number;
  blendMode: string;
  id?: string;
  path?: paper.PathItem;
};

// ===================== CONFIGURATION =====================

const CONFIG = {
  // Allow higher raster precision for visibility tests to avoid destructive clipping
  MAX_BUFFER_SIZE: 2048,
  MAX_RECURSION_DEPTH: 32,
  BOOLEAN_COMPLEXITY_CAP: 2000, 
  MIN_FILL_FACTOR: 0.15,
  TRAPPING_PIXELS: 0.35,
  POOL_SIZE: 4,
  VISIBILITY_SAMPLE_CAP: 12000,
  VISIBILITY_SECOND_PASS_SCALE: 0.5,
  WINDOW_RETENTION_RATIO: 0.0025,
};

// ===================== PUBLIC API =====================

export async function optimizeSvg(
  svgString: string,
  options: ScissorOptions = {},
  onProgress?: (percent: number) => void
): Promise<{ svg: string; stats: OptimizationStats }> {
  const start = performance.now();
  
  const sensitivity = Math.max(0, Math.min(1, options.sensitivity ?? 0.5));
  const targetRes = Math.min(
    Math.max(options.resolution ?? 1024, 256),
    CONFIG.MAX_BUFFER_SIZE
  );
  // Stricter retention policy: if even 1 pixel is visible, keep it, to avoid holes in gradients
  const minVisiblePixels = Math.max(1, Math.round(5 * (1.1 - sensitivity)));
  const removalThresholdBase = 0.005 + (1 - sensitivity) * 0.025; // was 1-5%, now 0.5-3%

  const stats: OptimizationStats = {
    originalSize: svgString.length,
    finalSize: 0,
    shapesProcessed: 0,
    shapesCulled: 0,
    shapesClipped: 0,
    shapesDeduped: 0,
    runtimeMs: 0,
  };

  const source = prepareSource(svgString);
  const meta = source.meta;

  const scope = new paper.PaperScope();
  scope.setup(new paper.Size(meta.viewBox.width, meta.viewBox.height));

  if (onProgress) onProgress(5);

  const rootItem = scope.project.importSVG(source.markup, {
    expandShapes: true,
    insert: true,
    applyMatrix: true, 
  });

  const rawItems = flattenItems(rootItem, scope, 0, source.paints);
  stats.shapesProcessed = rawItems.length;
  
  rootItem.remove();

  if (onProgress) onProgress(15);

  const viewBounds = new scope.Rectangle(
    0,
    0,
    meta.viewBox.width,
    meta.viewBox.height
  );
  const oracle = OraclePool.acquire(targetRes, targetRes);
  oracle.reset(viewBounds);

  const finalShapes: ProcessedShape[] = [];
  
  const zSorted = rawItems.reverse();

  for (let i = 0; i < zSorted.length; i++) {
    const shapeProps = zSorted[i];
    
    if (i % 40 === 0) {
        if (onProgress) onProgress(15 + Math.floor((i / zSorted.length) * 80));
        await yieldToMain();
    }

    // Trivial Rejection
    const effectiveOpacity = shapeProps.opacity * shapeProps.fillOpacity;
    if (effectiveOpacity <= 0.001 || (shapeProps.fill === null && shapeProps.stroke === null)) {
      stats.shapesCulled++;
      continue;
    }

    const paperPath = shapeProps.path;
    if (!paperPath) {
      stats.shapesCulled++;
      continue;
    }
    const boundsArea = paperPath.bounds.area;
    
    const strokeOnly =
      Boolean(shapeProps.stroke) &&
      Math.abs(((paperPath as any).area ?? 0)) < 1e-2;

    // Visibility Query
    const visibility = oracle.queryVisibility(paperPath);

    if (!strokeOnly && visibility.pixelCount < minVisiblePixels) {
      stats.shapesCulled++;
      paperPath.remove();
      continue;
    }

    const finalPathData = shapeProps.pathData;

    // Compute how much of the shape remains visible in world units
    const pathAreaMetric = Math.abs(((paperPath as any).area ?? 0));
    const pathLength = Math.abs(((paperPath as any).length ?? 0));
    const strokeFootprint =
      shapeProps.stroke && pathLength > 0
        ? Math.max(pathLength * (shapeProps.strokeWidth || 1), 0)
        : 0;
    const approxShapeArea =
      pathAreaMetric > 1e-2
        ? pathAreaMetric
        : strokeFootprint > 0
        ? strokeFootprint
        : Math.max(boundsArea, 1);

    if (!strokeOnly && visibility.pixelArea > 0 && approxShapeArea > 0) {
      const visibleArea = visibility.pixelCount * visibility.pixelArea;
      const visibleRatio = Math.min(
        visibleArea / Math.max(approxShapeArea, 1e-2),
        1
      );

      const windowAreaRatio =
        visibility.window && boundsArea > 0
          ? Math.min(visibility.window.area / boundsArea, 1)
          : 0;

      const shouldCull =
        visibleRatio <= removalThresholdBase &&
        windowAreaRatio <= CONFIG.WINDOW_RETENTION_RATIO &&
        visibility.pixelCount < minVisiblePixels * 2;

      if (shouldCull) {
        stats.shapesCulled++;
        paperPath.remove();
        continue;
      }
    }

    oracle.burn(paperPath, shapeProps);

    paperPath.remove();

    const emitted: ProcessedShape = {
      ...shapeProps,
      pathData: minifyD(finalPathData, 3),
    };
    delete emitted.path;
    finalShapes.push(emitted);
  }

  OraclePool.release(oracle);
  
  if (onProgress) onProgress(98);

  finalShapes.reverse();
  
  const { outputSvg, dedupCount } = reconstructSvg(finalShapes, meta, source.defs);
  stats.shapesDeduped = dedupCount;
  stats.finalSize = outputSvg.length;
  stats.runtimeMs = performance.now() - start;

  scope.project.remove();
  
  if (onProgress) onProgress(100);
  return { svg: outputSvg, stats };
}

// ===================== ORACLE & POOL =====================

class OraclePool {
  private static pool: RasterOracle[] = [];

  static acquire(w: number, h: number): RasterOracle {
    const oracle = this.pool.pop();
    if (oracle) {
        oracle.resize(w, h); 
        return oracle;
    }
    return new RasterOracle(w, h);
  }

  static release(oracle: RasterOracle) {
    if (this.pool.length < CONFIG.POOL_SIZE) {
        this.pool.push(oracle);
    } else {
        oracle.dispose();
    }
  }
}

class RasterOracle {
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private width: number = 0;
  private height: number = 0;
  private scaleX: number = 1;
  private scaleY: number = 1;

  constructor(w: number, h: number) {
    this.allocate(w, h);
  }

  private allocate(w: number, h: number) {
    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas = new OffscreenCanvas(w, h);
        } else if (typeof document !== 'undefined') {
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            this.canvas = c;
        }
        
        if (this.canvas) {
            this.ctx = this.canvas.getContext("2d", { 
                willReadFrequently: true,
                alpha: false 
            }) as any;
            this.width = w;
            this.height = h;
        }
    } catch(e) {}
  }

  public resize(w: number, h: number) {
    if (!this.canvas || this.width !== w || this.height !== h) this.allocate(w, h);
  }

  public dispose() {
    this.ctx = null;
    this.canvas = null;
  }

  public reset(viewBox: paper.Rectangle) {
    if (!this.ctx) return;
    this.scaleX = this.width / viewBox.width;
    this.scaleY = this.height / viewBox.height;
    
    this.ctx.fillStyle = "#000000"; 
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  public queryVisibility(path: paper.PathItem): {
    pixelCount: number;
    window: { rect: paper.Rectangle; area: number } | null;
    pixelArea: number;
  } {
    if (!this.ctx)
      return { pixelCount: 0, window: null, pixelArea: this.currentPixelArea() };

    const bounds = path.bounds;
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.width)) {
      return { pixelCount: 0, window: null, pixelArea: this.currentPixelArea() };
    }

    const x = Math.floor(bounds.x * this.scaleX);
    const y = Math.floor(bounds.y * this.scaleY);
    const w = Math.ceil(bounds.width * this.scaleX);
    const h = Math.ceil(bounds.height * this.scaleY);

    if (x >= this.width || y >= this.height || x + w < 0 || y + h < 0) {
        return { pixelCount: 0, window: null, pixelArea: this.currentPixelArea() };
    }

    const readX = Math.max(0, x);
    const readY = Math.max(0, y);
    const readW = Math.floor(Math.min(this.width - readX, w));
    const readH = Math.floor(Math.min(this.height - readY, h));

    if (!Number.isFinite(readW) || !Number.isFinite(readH) || readW <= 0 || readH <= 0) {
        return { pixelCount: 0, window: null, pixelArea: this.currentPixelArea() };
    }

    const imgData = this.ctx.getImageData(readX, readY, readW, readH);
    const buf32 = new Uint32Array(imgData.data.buffer);
    
    const MAX_CHECKS = CONFIG.VISIBILITY_SAMPLE_CAP;
    const totalPixels = readW * readH;
    const baseStride = Math.max(
      1,
      Math.floor(Math.sqrt(totalPixels / MAX_CHECKS))
    );

    const samplePass = (stride: number) => {
      let visibleSamples = 0;
      let minX = readW, minY = readH, maxX = 0, maxY = 0;
      let checkedSamples = 0;
      const offsetX = stride > 1 ? Math.floor(stride / 2) : 0;
      const offsetY = stride > 1 ? Math.floor(stride / 2) : 0;

      for (let py = 0; py < readH; py += stride) {
        const sy = Math.min(readH - 1, py + offsetY);
        for (let px = 0; px < readW; px += stride) {
          const sx = Math.min(readW - 1, px + offsetX);
          const offset = sy * readW + sx;
          checkedSamples++;
          
          // Check for background (unburned) pixels
          if ((buf32[offset] & 0x00FFFFFF) === 0) {
            const worldPt = new paper.Point(
              (readX + sx) / this.scaleX,
              (readY + sy) / this.scaleY
            );
            if (path.contains(worldPt)) {
              visibleSamples++;
              if (sx < minX) minX = sx;
              if (sy < minY) minY = sy;
              if (sx > maxX) maxX = sx;
              if (sy > maxY) maxY = sy;
            }
          }
        }
      }

      return { visibleSamples, checkedSamples, minX, minY, maxX, maxY };
    };

    let stride = baseStride;
    let { visibleSamples, checkedSamples, minX, minY, maxX, maxY } =
      samplePass(stride);

    // If we missed everything with a coarse stride, run a denser second pass
    if (visibleSamples === 0 && stride > 1) {
      stride = Math.max(
        1,
        Math.floor(stride * CONFIG.VISIBILITY_SECOND_PASS_SCALE)
      );
      const pass2 = samplePass(stride);
      visibleSamples = pass2.visibleSamples;
      checkedSamples = pass2.checkedSamples;
      minX = pass2.minX;
      minY = pass2.minY;
      maxX = pass2.maxX;
      maxY = pass2.maxY;
    }

    if (visibleSamples === 0) {
        return { pixelCount: 0, window: null, pixelArea: this.currentPixelArea() };
    }

    const ratio = visibleSamples / Math.max(checkedSamples, 1);
    const estimatedPixels = totalPixels * ratio;

    const buffer = 4 / this.scaleX;
    const worldRect = new paper.Rectangle(
        (readX + minX) / this.scaleX - buffer,
        (readY + minY) / this.scaleY - buffer,
        ((maxX - minX)) / this.scaleX + (buffer * 2),
        ((maxY - minY)) / this.scaleY + (buffer * 2)
    );

    return {
        pixelCount: estimatedPixels,
        window: { rect: worldRect, area: worldRect.area },
        pixelArea: this.currentPixelArea()
    };
  }

  private currentPixelArea(): number {
    if (this.scaleX <= 0 || this.scaleY <= 0) return 0;
    return 1 / (this.scaleX * this.scaleY);
  }

  public burn(path: paper.PathItem, props: ProcessedShape) {
    if (!this.ctx) return;
    
    // Strict Occlusion: Only opaque, normal blend, filled shapes occlude background
    if (props.blendMode !== 'normal' || props.opacity * props.fillOpacity < 0.99) {
        return;
    }
    if (props.fill?.includes("url(") || props.stroke?.includes("url(")) {
        return;
    }

    this.ctx.save();
    this.ctx.scale(this.scaleX, this.scaleY);
    this.ctx.fillStyle = "#FFFFFF"; 
    this.ctx.strokeStyle = "#FFFFFF";
    
    const p = new Path2D(path.pathData);
    
    if (props.fill) {
        // Honor fill-rule during burn to prevent over-occlusion
        if (props.fillRule === 'evenodd') this.ctx.fill(p, 'evenodd');
        else this.ctx.fill(p);
    }
    
    if (props.stroke) {
        this.ctx.lineWidth = Math.max(
            (props.strokeWidth || 0) + CONFIG.TRAPPING_PIXELS,
            0.5
        );
        this.ctx.stroke(p);
    }
    this.ctx.restore();
  }
}

// ===================== HELPERS =====================

type SvgMeta = {
  width: string;
  height: string;
  viewBox: { width: number; height: number };
};

type PaintReference = { fill?: string; stroke?: string };

type SvgSource = {
  markup: string;
  meta: SvgMeta;
  defs: string;
  paints: Map<string, PaintReference>;
};

const isPaintReference = (value: string | null): boolean =>
  Boolean(value && value.includes("url("));

/**
 * Reads the root attributes off the parsed document rather than the raw text.
 * A regular expression over the whole file matches the first width= it finds,
 * which is just as likely to be a child rect or a stroke-width.
 *
 * Shapes painted with url(#id) also get a stable id here. paper turns an
 * element id into an item name, which is the only handle left afterwards for
 * putting the gradient or pattern reference back on the rebuilt shape.
 */
function prepareSource(svgString: string): SvgSource {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("optimizer.errors.parse");
  const root = doc.querySelector("svg");
  if (!root) throw new Error("optimizer.errors.invalidRoot");

  let vx = 0;
  let vy = 0;
  let vw = 512;
  let vh = 512;
  const viewBox = (root.getAttribute("viewBox") || "")
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const widthAttr = root.getAttribute("width");
  const heightAttr = root.getAttribute("height");

  if (viewBox.length === 4) {
    [vx, vy, vw, vh] = viewBox;
  } else {
    const w = parseFloat(widthAttr || "");
    const h = parseFloat(heightAttr || "");
    if (Number.isFinite(w) && Number.isFinite(h)) {
      vw = w;
      vh = h;
    }
  }

  const paints = new Map<string, PaintReference>();
  let counter = 0;
  root.querySelectorAll("*").forEach((el) => {
    const fill = el.getAttribute("fill");
    const stroke = el.getAttribute("stroke");
    if (!isPaintReference(fill) && !isPaintReference(stroke)) return;
    const id = el.getAttribute("id") || "sp" + counter++;
    el.setAttribute("id", id);
    paints.set(id, {
      fill: isPaintReference(fill) ? fill! : undefined,
      stroke: isPaintReference(stroke) ? stroke! : undefined,
    });
  });

  const serializer = new XMLSerializer();
  const defs = Array.from(root.querySelectorAll("defs"))
    .map((node) => serializer.serializeToString(node))
    .join("");

  // Hand paper the box we resolved. A missing or malformed viewBox otherwise
  // gives it a degenerate transform that collapses the whole document.
  root.setAttribute("viewBox", vx + " " + vy + " " + vw + " " + vh);
  root.removeAttribute("width");
  root.removeAttribute("height");

  return {
    markup: serializer.serializeToString(root),
    meta: {
      width: widthAttr || String(vw),
      height: heightAttr || String(vh),
      viewBox: { width: Math.max(vw, 1), height: Math.max(vh, 1) },
    },
    defs,
    paints,
  };
}

function colorToHex(color: paper.Color): string | null {
    if (!color || !Number.isFinite(color.red)) return null;
    const toHex = (c: number) => {
        const hex = Math.round(c * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(color.red)}${toHex(color.green)}${toHex(color.blue)}`;
}

/**
 * Group opacity is carried down as `inherited`: the groups themselves are
 * dropped, so a shape inside <g opacity="0.5"> has to leave with that 0.5.
 */
function flattenItems(
    item: paper.Item,
    scope: paper.PaperScope,
    depth: number,
    paints: Map<string, PaintReference>,
    inherited = 1
): ProcessedShape[] {
    if (depth > CONFIG.MAX_RECURSION_DEPTH) return [];

    const shapes: ProcessedShape[] = [];

    if (!item.visible || item.opacity === 0) return [];

    if (item instanceof scope.Path || item instanceof scope.CompoundPath) {
        const p = item as paper.PathItem;
        const named = p.name && /^[a-zA-Z][\w:.-]*$/.test(p.name) ? p.name : undefined;
        const paint = named ? paints.get(named) : undefined;

        let fill = null;
        let fillOpacity = 1;

        if (p.fillColor) {
            fill = colorToHex(p.fillColor);
            if (p.fillColor.alpha < 1) fillOpacity = p.fillColor.alpha;
        }
        if (paint?.fill) fill = paint.fill;

        let stroke = null;
        let strokeOpacity = 1;
        if (p.strokeColor) {
             stroke = colorToHex(p.strokeColor);
             if (p.strokeColor.alpha < 1) strokeOpacity = p.strokeColor.alpha;
        }
        if (paint?.stroke) stroke = paint.stroke;

        shapes.push({
            pathData: p.pathData,
            fill,
            fillOpacity,
            fillRule: p.fillRule,
            stroke,
            strokeOpacity,
            strokeWidth: p.strokeWidth ?? 1,
            strokeLinecap: p.strokeCap ?? 'butt',
            strokeLinejoin: p.strokeJoin ?? 'miter',
            opacity: p.opacity * inherited,
            blendMode: p.blendMode,
            id: named,
            path: p.clone({ insert: false })
        });
    } else if (item.children) {
        for (const child of item.children) {
            shapes.push(...flattenItems(child, scope, depth + 1, paints, inherited * item.opacity));
        }
    }

    return shapes;
}

function reconstructSvg(shapes: ProcessedShape[], meta: SvgMeta, sourceDefs: string): { outputSvg: string, dedupCount: number } {
  const defsMap = new Map<string, string>();
  const pathCounts = new Map<string, number>();
  let dedupCount = 0;

  shapes.forEach(s => {
    pathCounts.set(s.pathData, (pathCounts.get(s.pathData) || 0) + 1);
  });

  let defsHtml = "";
  let defIndex = 0;
  
  shapes.forEach(s => {
    const count = pathCounts.get(s.pathData) || 0;
    if (count > 1 && s.pathData.length > 40 && !defsMap.has(s.pathData)) {
        const id = `d${defIndex++}`;
        defsMap.set(s.pathData, id);
        defsHtml += `<path id="${id}" d="${s.pathData}" />`;
    }
  });

  let bodyHtml = "";
  shapes.forEach(s => {
    const attrs: string[] = [];
    
    if (s.id) attrs.push(`id="${s.id}"`);
    
    if (s.fill) {
        attrs.push(`fill="${s.fill}"`);
        if (s.fillOpacity < 1) attrs.push(`fill-opacity="${s.fillOpacity.toFixed(2)}"`);
        if (s.fillRule && s.fillRule !== 'nonzero') attrs.push(`fill-rule="${s.fillRule}"`);
    } else {
        attrs.push(`fill="none"`);
    }
    
    if (s.stroke) {
        attrs.push(`stroke="${s.stroke}"`);
        if (s.strokeOpacity < 1) attrs.push(`stroke-opacity="${s.strokeOpacity.toFixed(2)}"`);
        attrs.push(`stroke-width="${+s.strokeWidth.toFixed(2)}"`);
        if(s.strokeLinecap !== 'butt') attrs.push(`stroke-linecap="${s.strokeLinecap}"`);
        if(s.strokeLinejoin !== 'miter') attrs.push(`stroke-linejoin="${s.strokeLinejoin}"`);
    }
    
    if (s.opacity < 1) attrs.push(`opacity="${s.opacity.toFixed(2)}"`);
    if (s.blendMode !== 'normal') attrs.push(`style="mix-blend-mode:${s.blendMode}"`);

    const defId = defsMap.get(s.pathData);
    if (defId) {
        dedupCount++;
        bodyHtml += `<use href="#${defId}" ${attrs.join(" ")} />`;
    } else {
        bodyHtml += `<path d="${s.pathData}" ${attrs.join(" ")} />`;
    }
  });

  const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.viewBox.width} ${meta.viewBox.height}">`;
  const defsBlock = sourceDefs + (defsHtml ? `<defs>${defsHtml}</defs>` : "");
  
  return {
      outputSvg: `${svgOpen}${defsBlock}${bodyHtml}</svg>`,
      dedupCount
  };
}

function minifyD(d: string, precision: number): string {
    if (!d || d.length < 5) return "";
    try {
        return new SVGPathCommander(d, { round: Math.max(precision, 3) })
          .optimize()
          .toString();
    } catch (e) {
        return d;
    }
}

function yieldToMain() {
  return new Promise(r => setTimeout(r, 0));
}
