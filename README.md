# SVG Optimizer

Browser-based SVG optimizer. Everything runs client-side; no file leaves the
machine.

Four engines, two ideas behind them:

| Engine | Idea |
| --- | --- |
| Geometry (`crop`) | Subtracts an accumulated union of the shapes above from each shape |
| Fast crop (`fastcrop`) | The same, with looser size guards |
| Raster | Draws into a canvas and counts the pixels that survive |
| Scissor | The same coverage test, cull only, with `<use>` deduplication |

They are composed as a pipeline in the UI, so a cheap pass can run before an
expensive one.

## Run

```bash
npm install
npm run dev
```

| URL | What it is |
| --- | --- |
| `/` | The optimizer |
| `/selftest` | The acceptance gate (development builds only) |

## The acceptance gate

`/selftest` runs 17 fixtures through all four engines, renders the original and
the output at 256, 512 and 1024 px, and counts the pixels that actually differ.
It exists because the engines' own numbers cannot tell you whether the picture
survived, and every safety threshold in them is otherwise a guess.

Expect **68 passed, 0 failed**. Keep the tab in front while it runs; a
background tab slows the renders down several times over.

Three rows carry a recorded allowance rather than zero, each with its reason in
`src/dev/optimizerFixtures.ts`:

- **dashed** — a `<rect>` becomes a path with a different start point, so the
  dashes land at a different phase. The geometry is identical.
- **groupOpacity** — `<g opacity>` composites the group once; flattened, each
  shape carries the opacity and the overlap composites twice.
- **logo.svg / crop, fastcrop** — trapping thickens outlines after a boolean
  cut, by design (`enableTraps`).

Every fixture in that file is a bug that shipped at least once. Add one whenever
you find another.

## Known limits

- Compressed size is what the accept/reject guard scores, because raw and gzip
  do not move together: cutting a path shortens the string but varies its
  coordinates, which compresses worse.
- `paper`'s `simplify()` stops honouring the requested tolerance once a path is
  near-minimal, so a refit path has to prove it stayed close before it can win
  on length.
- Boolean cutting rarely pays on organic, heavily overlapping artwork. It pays
  on geometric and icon work, where a cut removes a large simple region.

## Deploy

Vercel, as a static Vite build. `vercel.json` rewrites every path to
`index.html` so `/selftest` resolves on a deep link — though the page itself is
absent from production builds.
