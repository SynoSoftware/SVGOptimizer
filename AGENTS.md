# Working rules for this repository

## Do not spend the machine's time carelessly

Long, CPU-heavy operations need a reason stated before they are run, not after.
Weigh the cost against what the command actually buys, and prefer the narrower
command that answers the same question.

**`rm -rf node_modules package-lock.json && npm install` is not acceptable.**
It costs minutes, discards a resolved dependency tree that was working, and
re-downloads everything to fix what is usually a single package. It was used
once in this repository, on advice, to move from HeroUI 2 to 3. That was not
weighed first and should not be repeated.

Reach for the narrow tool instead:

| Instead of | Use |
| --- | --- |
| Full wipe and reinstall | `npm install <pkg>@<version>` for the package that actually changed |
| Full wipe to clear a bad state | `npm ls <pkg>` first, to find out what the bad state actually is |
| Reinstall to fix a peer conflict | Read the ERESOLVE output; it names the conflicting pair |
| Reinstall after editing package.json | Plain `npm install`, which reconciles in place |

If a full reinstall genuinely is the only way forward, say so first, say why the
narrow options cannot work, and get agreement before starting it.

The same applies to anything else that burns minutes: full production builds
used as a typecheck (`tsc --noEmit` is seconds), re-running the whole self-test
to check one fixture, or repeated `npm run build` when nothing that reaches the
bundle has changed.

## Verify with the cheapest thing that actually proves it

- `npx tsc -p tsconfig.app.json --noEmit` — seconds. The default check.
- `/selftest` in a dev build — about a minute, 68 checks. Run it when engine
  behaviour or its inputs could have moved, not after every edit.
- `npm run build` — over a minute. Run it before a commit that ships, not as a
  progress check.

## The self-test is the contract

`/selftest` asks two questions and a row must clear both: did the picture
survive (pixels against the input), and did anything change since last time
(digest, sizes and engine counters against `src/dev/optimizerBaseline.ts`).

The second exists because the first has a hole — an engine that returns its
input untouched scores zero pixel difference and passes. Do not remove it, and
do not refresh the baseline to make a red row go green without first
establishing that the change was intended.

## No linter here, deliberately

TypeScript 7 has no typescript-eslint release that supports it, so ESLint cannot
parse `.ts`/`.tsx` at all. Rather than keep a `lint` script that silently checks
nothing, ESLint and its plugins were removed. `tsc` and the self-test are the
gates. Do not add a lint script back without resolving that first.

## Leave the working tree as you found it

No commits, pushes, or history rewriting unless asked. Do not revert or
overwrite changes you did not make. Stop background servers and processes when
the work that needed them is done.
