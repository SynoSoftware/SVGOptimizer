/**
 * Recorded output of every engine on every fixture.
 *
 * The pixel comparison in the self-test asks whether the output still looks
 * like the *input*. That is the wrong question during a refactor, and it has a
 * hole you can drive a bus through: an engine that returned its input untouched
 * would score a zero percent difference and pass every check. It cannot tell
 * "works correctly" from "does nothing".
 *
 * This asks the other question - did anything change since last time - by
 * comparing bytes against a recorded baseline. Identical bytes are identical
 * pixels, so it is both stricter and cheaper than re-rendering.
 *
 * When a row drifts, decide which it is:
 *   - intended  -> press "Copy baseline" on the self-test page and paste here
 *   - not       -> you just caught a regression
 *
 * `output` holds the whole result for the small fixtures so the diff is
 * readable in review. Fixtures marked `hashOnly` produce tens of kilobytes per
 * engine, which would bury any real change, so only their digest is kept.
 */

export type BaselineEntry = {
  /** Bytes of the emitted document. */
  raw: number;
  /** Bytes after gzip, which is what actually ships. */
  gzip: number;
  /** Engine counters, so "it silently stopped cutting" cannot pass unnoticed. */
  stats: Record<string, number>;
  /** Full output, or omitted for fixtures recorded by digest alone. */
  output?: string;
  /** SHA-256 of the output, always present. */
  digest: string;
};

/** Keyed "<fixture>/<engine>". */
export type Baseline = Record<string, BaselineEntry>;

/** Fixtures too large to store in full; only their digest is compared. */
export const HASH_ONLY = new Set(["logo.svg"]);

export async function digestOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export type Drift =
  | { kind: "new" }
  | { kind: "output"; wasDigest: string; nowDigest: string }
  | { kind: "size"; field: "raw" | "gzip"; was: number; now: number }
  | { kind: "stat"; field: string; was: number; now: number };

/** Everything that moved for one fixture and engine, or an empty list. */
export function compareToBaseline(
  recorded: BaselineEntry | undefined,
  current: BaselineEntry
): Drift[] {
  if (!recorded) return [{ kind: "new" }];

  // A changed digest explains any size or stat move, so report it alone.
  if (recorded.digest !== current.digest) {
    return [
      { kind: "output", wasDigest: recorded.digest, nowDigest: current.digest },
    ];
  }

  const drift: Drift[] = [];
  for (const field of ["raw", "gzip"] as const) {
    if (recorded[field] !== current[field]) {
      drift.push({ kind: "size", field, was: recorded[field], now: current[field] });
    }
  }
  for (const field of Object.keys({ ...recorded.stats, ...current.stats })) {
    const was = recorded.stats[field] ?? 0;
    const now = current.stats[field] ?? 0;
    if (was !== now) drift.push({ kind: "stat", field, was, now });
  }
  return drift;
}

export function describeDrift(drift: Drift): string {
  switch (drift.kind) {
    case "new":
      return "not in the baseline";
    case "output":
      return `output changed (${drift.wasDigest} -> ${drift.nowDigest})`;
    case "size":
      return `${drift.field} ${drift.was} -> ${drift.now} bytes`;
    case "stat":
      return `${drift.field} ${drift.was} -> ${drift.now}`;
  }
}

/**
 * The recorded run. A row missing from here reports as new rather than quietly
 * passing, so an empty or partial baseline cannot be mistaken for green.
 */
export const BASELINE: Baseline = {
  "gradient/crop": {
    "raw": 322,
    "gzip": 219,
    "stats": {
      "initialBytes": 322,
      "optimizedBytes": 322,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "d5622d9ff11c4b1b",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f00\"/><stop offset=\"1\" stop-color=\"#00f\"/></linearGradient></defs><rect x=\"5\" y=\"5\" width=\"90\" height=\"90\" fill=\"url(#g)\"/><circle cx=\"50\" cy=\"50\" r=\"20\" fill=\"#fff\"/></svg>"
  },
  "gradient/raster": {
    "raw": 346,
    "gzip": 240,
    "stats": {
      "initialBytes": 322,
      "optimizedBytes": 346,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "50224e74371af664",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><defs><linearGradient id=\"a\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f00\"/><stop offset=\"1\" stop-color=\"#00f\"/></linearGradient></defs><path d=\"M5 95V5h90v90z\" fill=\"url(#a)\"/><path d=\"M30 50C30 39 39 30 50 30s20 9 20 20S61 70 50 70S30 61 30 50z\" fill=\"#fff\"/></svg>"
  },
  "polygon/crop": {
    "raw": 173,
    "gzip": 155,
    "stats": {
      "initialBytes": 196,
      "optimizedBytes": 173,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 1,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "6fa43faa2fc0216a",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 5l45 90H5z\" fill=\"#2b7\"/><path d=\"M10 10h80v20\" fill=\"none\" stroke=\"#111\" stroke-width=\"4\"/></svg>"
  },
  "polygon/raster": {
    "raw": 173,
    "gzip": 155,
    "stats": {
      "initialBytes": 196,
      "optimizedBytes": 173,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "6fa43faa2fc0216a",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 5l45 90H5z\" fill=\"#2b7\"/><path d=\"M10 10h80v20\" fill=\"none\" stroke=\"#111\" stroke-width=\"4\"/></svg>"
  },
  "curves/crop": {
    "raw": 277,
    "gzip": 196,
    "stats": {
      "initialBytes": 334,
      "optimizedBytes": 277,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 2,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "bf7f562f30bddccd",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path d=\"M512 100c288 0 388 200 388 412S800 924 512 924S124 724 124 512S224 100 512 100z\" fill=\"#3366cc\"/><path d=\"M300 400c80 -80 160 -80 240 0s80 160 0 240s-160 80 -240 0s-80 -160 0 -240z\" fill=\"#cc3366\"/></svg>"
  },
  "curves/raster": {
    "raw": 271,
    "gzip": 190,
    "stats": {
      "initialBytes": 334,
      "optimizedBytes": 271,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "17e857378684d9f6",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path d=\"M512 100c288 0 388 200 388 412S800 924 512 924S124 724 124 512S224 100 512 100z\" fill=\"#36c\"/><path d=\"M300 400c80 -80 160 -80 240 0s80 160 0 240s-160 80 -240 0s-80 -160 0 -240z\" fill=\"#c36\"/></svg>"
  },
  "rects/crop": {
    "raw": 185,
    "gzip": 144,
    "stats": {
      "initialBytes": 218,
      "optimizedBytes": 185,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 3,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "feac034f67499fb5",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M5 45V5h90v40z\" fill=\"#347\"/><path d=\"M5 95V55h40v40z\" fill=\"#a51\"/><path d=\"M55 55h40v40H55z\" fill=\"#0b7\"/></svg>"
  },
  "rects/raster": {
    "raw": 185,
    "gzip": 144,
    "stats": {
      "initialBytes": 218,
      "optimizedBytes": 185,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "feac034f67499fb5",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M5 45V5h90v40z\" fill=\"#347\"/><path d=\"M5 95V55h40v40z\" fill=\"#a51\"/><path d=\"M55 55h40v40H55z\" fill=\"#0b7\"/></svg>"
  },
  "occlusion/crop": {
    "raw": 227,
    "gzip": 161,
    "stats": {
      "initialBytes": 227,
      "optimizedBytes": 227,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 1,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "c83c6c89d7a9b434",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><rect x=\"10\" y=\"10\" width=\"30\" height=\"30\" fill=\"#0a0\"/><rect x=\"0\" y=\"0\" width=\"100\" height=\"100\" fill=\"#123456\"/><circle cx=\"50\" cy=\"50\" r=\"30\" fill=\"#fc0\"/></svg>"
  },
  "occlusion/raster": {
    "raw": 207,
    "gzip": 164,
    "stats": {
      "initialBytes": 227,
      "optimizedBytes": 207,
      "removedElements": 1,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 1,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "dd2d92a65ba727dc",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#123456\"/><path d=\"M20 50C20 33.4 33.4 20 50 20s30 13.4 30 30S66.6 80 50 80S20 66.6 20 50z\" fill=\"#fc0\"/></svg>"
  },
  "offsetViewBox/crop": {
    "raw": 166,
    "gzip": 144,
    "stats": {
      "initialBytes": 166,
      "optimizedBytes": 166,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "a0cd389918761a3c",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-12 -12 24 24\"><circle cx=\"0\" cy=\"0\" r=\"10\" fill=\"#e11\"/><rect x=\"-4\" y=\"-4\" width=\"8\" height=\"8\" fill=\"#11e\"/></svg>"
  },
  "offsetViewBox/raster": {
    "raw": 199,
    "gzip": 159,
    "stats": {
      "initialBytes": 166,
      "optimizedBytes": 199,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "d2edf04059bb08d0",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-12 -12 24 24\"><path d=\"M-10 0c0 -5.5 4.5 -10 10 -10s10 4.5 10 10S5.5 10 0 10S-10 5.5 -10 0z\" fill=\"#e11\"/><path d=\"M-4 4v-8h8v8z\" fill=\"#11e\"/></svg>"
  },
  "scaledViewBox/crop": {
    "raw": 193,
    "gzip": 150,
    "stats": {
      "initialBytes": 193,
      "optimizedBytes": 193,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "86efc4c2d8a3b62e",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\" viewBox=\"0 0 100 100\"><rect x=\"10\" y=\"10\" width=\"40\" height=\"40\" fill=\"#e11\"/><circle cx=\"70\" cy=\"70\" r=\"20\" fill=\"#11e\"/></svg>"
  },
  "scaledViewBox/raster": {
    "raw": 217,
    "gzip": 172,
    "stats": {
      "initialBytes": 193,
      "optimizedBytes": 217,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "b2bfdd362bb7e60b",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"200\" viewBox=\"0 0 100 100\"><path d=\"M10 50V10h40v40z\" fill=\"#e11\"/><path d=\"M50 70C50 59 59 50 70 50s20 9 20 20S81 90 70 90S50 81 50 70z\" fill=\"#11e\"/></svg>"
  },
  "donut/crop": {
    "raw": 233,
    "gzip": 172,
    "stats": {
      "initialBytes": 252,
      "optimizedBytes": 233,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 2,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "ce87d536f5415dbd",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 5a45 45 0 1 0 0 90A45 45 0 1 0 50 5zm0 20a25 25 0 1 1 0 50a25 25 0 1 1 0 -50z\" fill=\"#444\" fill-rule=\"evenodd\"/><path d=\"M40 60V40h20v20z\" fill=\"#0bf\"/></svg>"
  },
  "donut/raster": {
    "raw": 233,
    "gzip": 172,
    "stats": {
      "initialBytes": 252,
      "optimizedBytes": 233,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "ce87d536f5415dbd",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 5a45 45 0 1 0 0 90A45 45 0 1 0 50 5zm0 20a25 25 0 1 1 0 50a25 25 0 1 1 0 -50z\" fill=\"#444\" fill-rule=\"evenodd\"/><path d=\"M40 60V40h20v20z\" fill=\"#0bf\"/></svg>"
  },
  "transformed/crop": {
    "raw": 146,
    "gzip": 132,
    "stats": {
      "initialBytes": 223,
      "optimizedBytes": 146,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 2,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 1,
      "fallbackTriggered": 0
    },
    "digest": "326afdb24f5f0799",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 90V50h40v40z\" fill=\"#c00\"/><path d=\"M0 20V0h20v20z\" fill=\"#00c\"/></svg>"
  },
  "transformed/raster": {
    "raw": 146,
    "gzip": 132,
    "stats": {
      "initialBytes": 223,
      "optimizedBytes": 146,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 1,
      "fallbackTriggered": 0
    },
    "digest": "326afdb24f5f0799",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M50 90V50h40v40z\" fill=\"#c00\"/><path d=\"M0 20V0h20v20z\" fill=\"#00c\"/></svg>"
  },
  "inheritPaint/crop": {
    "raw": 155,
    "gzip": 146,
    "stats": {
      "initialBytes": 176,
      "optimizedBytes": 155,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "dd9c8acc0257c0e4",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 10h35v35H10zm45 45h35v35H55z\" fill=\"#3a7\" stroke=\"#036\" stroke-width=\"3\"/></svg>"
  },
  "inheritPaint/raster": {
    "raw": 174,
    "gzip": 154,
    "stats": {
      "initialBytes": 176,
      "optimizedBytes": 174,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "510717087a27194a",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><g fill=\"#3a7\" stroke=\"#036\" stroke-width=\"3\"><path d=\"M10 10h35v35H10z\"/><path d=\"M55 55h35v35H55z\"/></g></svg>"
  },
  "strokeOnly/crop": {
    "raw": 292,
    "gzip": 171,
    "stats": {
      "initialBytes": 339,
      "optimizedBytes": 292,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 1,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "b83a59d497936cf0",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#eee\"/><path d=\"M10 20h80\" stroke=\"#c00\" stroke-width=\"2\"/><path d=\"M10 50h80\" fill=\"none\" stroke=\"#00c\" stroke-width=\"2\"/><path d=\"M10 70h40h40\" fill=\"none\" stroke=\"#0a0\" stroke-width=\"2\"/></svg>"
  },
  "strokeOnly/raster": {
    "raw": 292,
    "gzip": 171,
    "stats": {
      "initialBytes": 339,
      "optimizedBytes": 292,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "b83a59d497936cf0",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#eee\"/><path d=\"M10 20h80\" stroke=\"#c00\" stroke-width=\"2\"/><path d=\"M10 50h80\" fill=\"none\" stroke=\"#00c\" stroke-width=\"2\"/><path d=\"M10 70h40h40\" fill=\"none\" stroke=\"#0a0\" stroke-width=\"2\"/></svg>"
  },
  "strokeNoWidth/crop": {
    "raw": 191,
    "gzip": 147,
    "stats": {
      "initialBytes": 217,
      "optimizedBytes": 191,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 1,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "53665c6002633d64",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#eee\"/><path d=\"M10 30h80\" stroke=\"#c00\"/><path d=\"M10 60h80\" fill=\"none\" stroke=\"#c00\"/></svg>"
  },
  "strokeNoWidth/raster": {
    "raw": 191,
    "gzip": 147,
    "stats": {
      "initialBytes": 217,
      "optimizedBytes": 191,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "53665c6002633d64",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#eee\"/><path d=\"M10 30h80\" stroke=\"#c00\"/><path d=\"M10 60h80\" fill=\"none\" stroke=\"#c00\"/></svg>"
  },
  "thin/crop": {
    "raw": 283,
    "gzip": 166,
    "stats": {
      "initialBytes": 283,
      "optimizedBytes": 283,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "fd734005fc654b1c",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><rect x=\"0\" y=\"0\" width=\"100\" height=\"100\" fill=\"#eee\"/><rect x=\"10\" y=\"20\" width=\"80\" height=\"0.6\" fill=\"#000\"/><rect x=\"10\" y=\"40\" width=\"80\" height=\"0.6\" fill=\"#000\"/><circle cx=\"50\" cy=\"70\" r=\"1.2\" fill=\"#c00\"/></svg>"
  },
  "thin/raster": {
    "raw": 300,
    "gzip": 188,
    "stats": {
      "initialBytes": 283,
      "optimizedBytes": 300,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "bb8befd07de2fe00",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M0 100V0h100v100z\" fill=\"#eee\"/><g fill=\"#000\"><path d=\"M10 20.6V20h80v0.6z\"/><path d=\"M10 40.6V40h80v0.6z\"/></g><path d=\"M48.8 70c0 -0.7 0.5 -1.2 1.2 -1.2s1.2 0.5 1.2 1.2s-0.5 1.2 -1.2 1.2S48.8 70.7 48.8 70z\" fill=\"#c00\"/></svg>"
  },
  "repeated/crop": {
    "raw": 271,
    "gzip": 182,
    "stats": {
      "initialBytes": 314,
      "optimizedBytes": 271,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 2,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 1,
      "fallbackTriggered": 0
    },
    "digest": "0f7bebbd125b854f",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 10c8 0 14 6 14 14S18 38 10 38S-4 32 -4 24S2 10 10 10z\" fill=\"#c33\"/><path d=\"M50 10c8 0 14 6 14 14S58 38 50 38S36 32 36 24S42 10 50 10z\" fill=\"#3c3\"/><path d=\"M10 90V60h80v30z\" fill=\"#333\"/></svg>"
  },
  "repeated/raster": {
    "raw": 271,
    "gzip": 182,
    "stats": {
      "initialBytes": 314,
      "optimizedBytes": 271,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 1,
      "fallbackTriggered": 0
    },
    "digest": "0f7bebbd125b854f",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 10c8 0 14 6 14 14S18 38 10 38S-4 32 -4 24S2 10 10 10z\" fill=\"#c33\"/><path d=\"M50 10c8 0 14 6 14 14S58 38 50 38S36 32 36 24S42 10 50 10z\" fill=\"#3c3\"/><path d=\"M10 90V60h80v30z\" fill=\"#333\"/></svg>"
  },
  "dashed/crop": {
    "raw": 162,
    "gzip": 149,
    "stats": {
      "initialBytes": 178,
      "optimizedBytes": 162,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 1,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "176ab5a0ec8a715d",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 90V10h80v80z\" fill=\"none\" stroke=\"#000\" stroke-dasharray=\"8 4\" stroke-width=\"3\"/></svg>"
  },
  "dashed/raster": {
    "raw": 162,
    "gzip": 149,
    "stats": {
      "initialBytes": 178,
      "optimizedBytes": 162,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "176ab5a0ec8a715d",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 90V10h80v80z\" fill=\"none\" stroke=\"#000\" stroke-dasharray=\"8 4\" stroke-width=\"3\"/></svg>"
  },
  "groupOpacity/crop": {
    "raw": 180,
    "gzip": 143,
    "stats": {
      "initialBytes": 201,
      "optimizedBytes": 180,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 2,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "1b0c8fdcf5b308c1",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 60V10h50v50z\" fill=\"#f0a\" opacity=\"0.500\"/><path d=\"M40 90V40h50v50z\" fill=\"#0af\" opacity=\"0.500\"/></svg>"
  },
  "groupOpacity/raster": {
    "raw": 176,
    "gzip": 141,
    "stats": {
      "initialBytes": 201,
      "optimizedBytes": 176,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 0,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "8e54209af4110e6d",
    "output": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><path d=\"M10 60V10h50v50z\" fill=\"#f0a\" opacity=\"0.5\"/><path d=\"M40 90V40h50v50z\" fill=\"#0af\" opacity=\"0.5\"/></svg>"
  },
  "logo.svg/crop": {
    "raw": 84190,
    "gzip": 21774,
    "stats": {
      "initialBytes": 84197,
      "optimizedBytes": 84190,
      "removedElements": 0,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 1,
      "flattenedTransforms": 0,
      "fallbackTriggered": 1
    },
    "digest": "5ff3d20c61a9a36b"
  },
  "logo.svg/raster": {
    "raw": 84076,
    "gzip": 21778,
    "stats": {
      "initialBytes": 84197,
      "optimizedBytes": 84076,
      "removedElements": 1,
      "invisibleElements": 0,
      "degenerateElements": 0,
      "optimizedPaths": 0,
      "gapRepairs": 0,
      "booleanUnions": 0,
      "hiddenLayers": 1,
      "flattenedTransforms": 0,
      "fallbackTriggered": 0
    },
    "digest": "836e01ddfbe5e020"
  },
};
