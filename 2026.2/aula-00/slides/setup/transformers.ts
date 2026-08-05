import {
  defineMarkdownTransformer,
  defineTransformersSetup,
} from '@slidev/types'

const citationPattern = /\[@([A-Za-z0-9][A-Za-z0-9_:./+-]*)\]/g

const transformCitationSyntax = defineMarkdownTransformer(({ s }) => {
  s.replace(
    citationPattern,
    (_match, citationKey: string) => `<Cite bref="${citationKey}" />`,
  )
})

export default defineTransformersSetup(() => ({
  pre: [transformCitationSyntax],
}))
