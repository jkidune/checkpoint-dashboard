import { checkpointContributionFix as createBaseContributionFix } from './contribution-transform.mjs'

// The base transform stores JSX templates with String.raw so nested template
// literals survive the source file. Normalize only those escaped template
// delimiters after the transform has produced the final Contributions source.
export function checkpointContributionFix() {
  const plugin = createBaseContributionFix()
  const baseTransform = plugin.transform

  return {
    ...plugin,
    name: 'checkpoint-contribution-fix-safe',
    transform(code, id) {
      const result = baseTransform.call(this, code, id)
      if (!result) return result

      const generated = typeof result === 'string' ? result : result.code
      const normalized = generated
        .replaceAll('\\`', '`')
        .replaceAll('\\${', '${')

      if (typeof result === 'string') return normalized
      return { ...result, code: normalized }
    },
  }
}
