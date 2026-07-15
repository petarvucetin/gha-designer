# Third-Party Licenses

GitHub Actions Designer is MIT-licensed (see `LICENSE`). The packaged desktop
build also redistributes the third-party components listed below. This file
documents those components and their licenses; it is a notices file, not a
license grant.

## Bundled external binaries (`src-tauri/tauri.conf.json` → `bundle.externalBin`)

The packaged app ships two external binaries, staged by `scripts/build-sidecar.mjs`:

### `binaries/act` — nektos/act (MIT)

`act` (https://github.com/nektos/act) is bundled unmodified as a sidecar binary
so the app can run GitHub Actions workflows locally. License text fetched
verbatim from https://raw.githubusercontent.com/nektos/act/master/LICENSE:

```
MIT License

Copyright (c) 2019

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `binaries/gha-runner` — Bun runtime (MIT, with statically linked components)

`gha-runner` is `server/runner-entry.ts` compiled with `bun build --compile`
(https://bun.sh), which embeds the Bun runtime into the output binary.

Per Bun's own notice (https://github.com/oven-sh/bun/blob/main/LICENSE.md):
"Bun itself is MIT-licensed." The compiled `bun` runtime also statically links
JavaScriptCore/WebKit (LGPL-2) and a number of other libraries under
permissive licenses (MIT, BSD, Apache-2.0, zlib; a couple of components are
dual-licensed, e.g. `zstd` under BSD/GPLv2). Bun's LICENSE.md lists every
linked library and its license, and documents how to obtain and relink the
patched WebKit source per the LGPL-2 terms — see that file for the full
breakdown; it is not reproduced here for brevity.

## Bundled npm dependencies — sidecar (`server/*.ts`, compiled into `gha-runner`)

The only third-party npm package imported by the production server code
(everything `bun build --compile` bundles into the sidecar) is:

| Package | Version | License |
|---|---|---|
| `yaml` | 2.9.0 | ISC |

(Confirmed by grepping `server/*.ts` production sources for non-relative,
non-`node:*` imports, and cross-checked with `node_modules/yaml/package.json`,
which lists no further dependencies of its own.)

## Bundled npm dependencies — frontend (webview bundle built by Vite)

Summary of direct production dependencies shipped in the built webview
bundle, per `npx license-checker --production --summary` and each package's
`node_modules/<pkg>/package.json` `license` field:

| Package | Version | License |
|---|---|---|
| `react` / `react-dom` | 18.3.1 | MIT |
| `@xyflow/react` | 12.11.2 | MIT |
| `@dagrejs/dagre` | 1.1.8 | MIT |
| `zustand` | 5.0.14 | MIT |
| `yaml` | 2.9.0 | ISC |
| `highlight.js` | 11.11.1 | BSD-3-Clause |
| `@tauri-apps/plugin-opener` | 2.5.4 | MIT OR Apache-2.0 |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT — bundled transitively as a dependency of `@tauri-apps/plugin-opener` |

Transitive dependencies pulled in by the above (mainly `@xyflow/react`'s use
of `d3-*` packages and `@dagrejs/graphlib`) are also permissively licensed:
`npx license-checker --production --summary` reports, across all 37
production packages (including this project itself, excluded here): 23 MIT,
9 ISC, 2 BSD-3-Clause, plus the two dual MIT/Apache-2.0 Tauri packages above.

## Not distributed

The following are used by this project but are **not** bundled or
redistributed in the packaged app:

- **Container images** (e.g. `catthehacker/ubuntu`, and any images built from
  `runner-image/`) — pulled from a registry or built locally by the user at
  run time; not shipped with the app.
- **The act runner VM image** — built by the user via Packer
  (`vm/packer/` configs), not shipped with the app.
