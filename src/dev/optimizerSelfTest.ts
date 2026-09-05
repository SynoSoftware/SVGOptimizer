/**
 * Renders every fixture before and after each engine and compares the pixels.
 *
 * The optimizer's own numbers cannot tell you whether the picture survived, and
 * every safety threshold in the engines is a guess made without that answer.
 * This gives the measured one, so a change to those thresholds can be judged
 * instead of argued about.
 *
 * It runs in the browser on purpose: the engines need canvas, getComputedStyle
 * and DOMParser, and no headless DOM will rasterise an SVG for us.
 */

import { optimizeSvg as optimizeCrop } from "../utils/svgOptimizer-crop";
import { optimizeSvg as optimizeFastCrop } from "../utils/svgOptimizer-fastcrop";
import { optimizeSvgRaster } from "../utils/svgOptimizer-raster";
import { optimizeSvg as optimizeScissor } from "../utils/svgOptimizer-scissor";
import {
  FIXTURES,
  type EngineName,
  type Fixture,
} from "./optimizerFixtures";

/** Channel-sum difference above which a pixel counts as changed. */
const PIXEL_DELTA = 30;
/** Anti-aliased edges never line up exactly; this much drift is not a finding. */
const DEFAULT_TOLERANCE = 1;
/**
 * Render sizes, in output pixels.
 *
 * Nothing below 256 is useful. At 128 a single pixel covers most of a hairline,
 * so a sub-pixel edge shift flips a percent of the image and all four engines
 * report the same number - that measures the browser's rasteriser, not whether
 * the artwork survived.
 */
export const SIZES = [256, 512, 1024];

const ENGINES: Record<EngineName, (svg: string) => Promise<string>> = {
  crop: (s) => optimizeCrop(s).then((r) => r.optimizedSvg),
  fastcrop: (s) => optimizeFastCrop(s).then((r) => r.optimizedSvg),
  raster: (s) => optimizeSvgRaster(s).then((r) => r.optimizedSvg),
  scissor: (s) => optimizeScissor(s).then((r) => r.svg),
};

export type Result = {
  fixture: string;
  engine: EngineName;
  ms: number;
  rawIn: number;
  rawOut: number;
  gzipIn: number;
  gzipOut: number;
  /** Largest channel-sum difference seen at any tested size. */
  maxDelta: number;
  /** Share of pixels past PIXEL_DELTA, at the worst size. */
  pctChanged: number;
  worstSize: number;
  /** Share of pixels past PIXEL_DELTA at each size, for reading the trend. */
  bySize: { size: number; pctChanged: number; maxDelta: number }[];
  tolerance: number;
  pass: boolean;
  error?: string;
};

export type Report = {
  results: Result[];
  passed: number;
  failed: number;
  ms: number;
};

export async function gzipSize(text: string): Promise<number> {
  if (typeof CompressionStream === "undefined") return byteSize(text);
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

export function byteSize(text: string): number {
  return new Blob([text]).size;
}

function render(svg: string, size: number): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return resolve(null);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => {
      try {
        ctx.drawImage(image, 0, 0, size, size);
      } catch {
        // A tainted or unsupported draw leaves the white ground in place, which
        // reads as a total difference rather than a silent pass.
      }
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, size, size).data);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function compare(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let maxDelta = 0;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta =
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > PIXEL_DELTA) changed += 1;
  }
  return { maxDelta, pctChanged: (100 * changed) / (a.length / 4) };
}

async function loadFixture(fixture: Fixture): Promise<string> {
  if (fixture.svg) return fixture.svg;
  if (!fixture.url) throw new Error("fixture has neither svg nor url");
  const response = await fetch(fixture.url + "?selftest=" + Date.now());
  if (!response.ok) throw new Error(fixture.url + " -> " + response.status);
  return response.text();
}

export async function runSelfTest(
  onProgress?: (done: number, total: number, label: string) => void
): Promise<Report> {
  const started = performance.now();
  const engines = Object.keys(ENGINES) as EngineName[];
  const total = FIXTURES.length * engines.length;
  const results: Result[] = [];
  let done = 0;

  for (const fixture of FIXTURES) {
    let source: string;
    try {
      source = await loadFixture(fixture);
    } catch (error) {
      for (const engine of engines) {
        results.push(
          failure(fixture.name, engine, toleranceFor(fixture, engine), String(error))
        );
        done += 1;
      }
      continue;
    }

    // The original only has to be drawn once per size, not once per engine.
    const baselines = new Map<number, Uint8ClampedArray | null>();
    for (const size of SIZES) baselines.set(size, await render(source, size));
    const rawIn = byteSize(source);
    const gzipIn = await gzipSize(source);

    for (const engine of engines) {
      const tolerance = toleranceFor(fixture, engine);
      onProgress?.(done, total, fixture.name + " / " + engine);
      const t0 = performance.now();
      let output: string;
      try {
        output = await ENGINES[engine](source);
      } catch (error) {
        results.push(
          failure(
            fixture.name,
            engine,
            tolerance,
            error instanceof Error ? error.message : String(error)
          )
        );
        done += 1;
        continue;
      }
      const ms = Math.round(performance.now() - t0);

      let maxDelta = 0;
      let pctChanged = 0;
      let worstSize = SIZES[0];
      let renderFailed = false;
      const bySize: Result["bySize"] = [];
      for (const size of SIZES) {
        const before = baselines.get(size);
        const after = await render(output, size);
        if (!before || !after) {
          renderFailed = true;
          break;
        }
        const seen = compare(before, after);
        bySize.push({
          size,
          pctChanged: +seen.pctChanged.toFixed(3),
          maxDelta: seen.maxDelta,
        });
        if (seen.maxDelta > maxDelta) maxDelta = seen.maxDelta;
        if (seen.pctChanged > pctChanged) {
          pctChanged = seen.pctChanged;
          worstSize = size;
        }
      }

      results.push({
        fixture: fixture.name,
        engine,
        ms,
        rawIn,
        rawOut: byteSize(output),
        gzipIn,
        gzipOut: await gzipSize(output),
        maxDelta,
        pctChanged: +pctChanged.toFixed(3),
        worstSize,
        bySize,
        tolerance,
        pass: !renderFailed && pctChanged <= tolerance,
        error: renderFailed ? "render failed" : undefined,
      });
      done += 1;
    }
  }

  onProgress?.(total, total, "done");
  return {
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    ms: Math.round(performance.now() - started),
  };
}

/** Per-engine allowance if one is recorded, otherwise the fixture's, otherwise the default. */
export function toleranceFor(fixture: Fixture, engine: EngineName): number {
  const declared = fixture.tolerance;
  if (typeof declared === "number") return declared;
  return declared?.[engine] ?? DEFAULT_TOLERANCE;
}

function failure(
  fixture: string,
  engine: EngineName,
  tolerance: number,
  error: string
): Result {
  return {
    fixture,
    engine,
    ms: 0,
    rawIn: 0,
    rawOut: 0,
    gzipIn: 0,
    gzipOut: 0,
    maxDelta: 0,
    pctChanged: 0,
    worstSize: 0,
    bySize: [],
    tolerance,
    pass: false,
    error,
  };
}
