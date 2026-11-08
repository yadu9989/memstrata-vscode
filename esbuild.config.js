// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Called It Inc.
const esbuild = require('esbuild');
esbuild.build({entryPoints:['src/extension.ts'],bundle:true,outfile:'out/extension.js',external:['vscode'],
    format:'cjs',platform:'node',target:'node20',sourcemap:true,minify:false}).catch(()=>process.exit(1));
