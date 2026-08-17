import { defineConfig } from 'vite'

// base '/puzzle/' porque o deploy é GitHub Pages de projeto (gbrein.github.io/puzzle).
// Em dev o base é '/', senão o servidor local serve numa subpasta à toa.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/puzzle/' : '/',
  build: { target: 'es2022' },
  worker: { format: 'es' },
}))
