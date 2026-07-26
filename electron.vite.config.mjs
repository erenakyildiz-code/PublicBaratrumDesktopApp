import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {},
  assetsInclude: ['**/*.vrm', '**/*.vrma', '**/*.bin', '**/*.mjs'],
  worker: {
    format: 'es'
  }
})
