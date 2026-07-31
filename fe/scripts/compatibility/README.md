# Compiler/runtime compatibility matrix

These scripts verify that one current Container/Render/Service runtime accepts
both:

- artifacts built by the pinned legacy compiler at
  `0a85e77156b4e28dd62377e1e2ea268d9eb6db2c`; and
- artifacts built by the compiler in the working tree.

The build report records the compiler revision, tracked source changes, source
hash, complete artifact hash, declared pages, template counts, and transport
fingerprints. A legacy report is valid only when it has no
`dimina-prop-bindings`, ownership metadata, or `wxsRoots`.

## Build both artifact sets

Create a clean worktree at the pinned revision and install or link its compiler
dependencies. Then run:

```sh
pnpm compat:build-demos \
  --compiler-root /path/to/legacy-worktree/fe \
  --source-root /path/to/current/fe/example \
  --output-root /tmp/dimina-artifacts-legacy

pnpm compat:build-demos \
  --compiler-root /path/to/current/fe \
  --source-root /path/to/current/fe/example \
  --output-root /tmp/dimina-artifacts-current
```

Each demo is compiled in a separate Node process so compiler singleton state
cannot leak from one app to another.

## Run all pages in the current runtime

Build the current production runtime first:

```sh
pnpm --filter container... build --mode production
```

Then run:

```sh
pnpm compat:run-demos \
  --container-dist ./packages/container/dist \
  --legacy-report /tmp/dimina-artifacts-legacy/compatibility-report.json \
  --current-report /tmp/dimina-artifacts-current/compatibility-report.json \
  --output /tmp/dimina-browser-compatibility.json
```

The browser runner opens every declared page in both modes. Subpackage pages
are reached through a main-package entry plus the normal restored page stack,
so the runtime loads the package root recorded in `app-config.json`.

The command fails when:

- any page fails to mount or leaves the launch screen visible;
- legacy and current artifacts produce asymmetric browser errors; or
- an applicable `setData` interaction probe fails.

`legacy-compiler-app` under the Render test fixtures contains the interaction
probe. It checks initial and post-click values for simple, compound, WXS,
`wx:for` item/index bindings, property observers, and `Page.setData`.

Expected warnings and 404s that occur symmetrically in both modes remain in the
JSON report. They are not hidden, but they are not classified as a compiler
protocol regression.
