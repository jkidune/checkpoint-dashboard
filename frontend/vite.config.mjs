import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { checkpointContributionFix } from './contribution-transform-safe.mjs'
import { checkpointContributionAmountInputFix } from './contribution-amount-input-fix.mjs'
import { checkpointLoanEnhancements } from './loan-transform-safe.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [checkpointContributionFix(), checkpointContributionAmountInputFix(), checkpointLoanEnhancements(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  }
})
