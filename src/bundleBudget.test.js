import { describe, expect, it } from 'vitest'
import { BUNDLE_BUDGETS, evaluateBundleBudget } from '../scripts/check-bundle-budget.mjs'

const currentShape = {
  // Measured from a production build after the entry chunk shed the unreachable
  // Supabase Storage/Functions clients and the lazily-loaded EFT log subsystem.
  entry: { rawBytes: 444_503, gzipBytes: 130_387 },
  largestAsyncRaw: { name: 'loot.js', rawBytes: 863_704, gzipBytes: 70_770 },
  largestAsyncGzip: { name: 'tasks.js', rawBytes: 797_995, gzipBytes: 109_960 },
  largestCssRaw: { name: 'index.css', rawBytes: 125_849, gzipBytes: 21_840 },
  largestCssGzip: { name: 'index.css', rawBytes: 125_849, gzipBytes: 21_840 },
}

describe('bundle budget checker', () => {
  it('accepts the current post-Room-split shape while warning on known data pressure', () => {
    const evaluation = evaluateBundleBudget(currentShape)

    expect(evaluation.ok).toBe(true)
    expect(evaluation.checks.find(check => check.name === 'entry gzip bytes').status).toBe('pass')
    expect(evaluation.checks.find(check => check.name === 'largest async JS raw bytes').status).toBe('warn')
  })

  it('fails when the initial entry crosses its release guardrail', () => {
    const evaluation = evaluateBundleBudget({
      ...currentShape,
      entry: { rawBytes: BUNDLE_BUDGETS.entry.rawBytes.fail + 1, gzipBytes: currentShape.entry.gzipBytes },
    })

    expect(evaluation.ok).toBe(false)
    expect(evaluation.checks.find(check => check.name === 'entry raw bytes').status).toBe('fail')
  })
})
