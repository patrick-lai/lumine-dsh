import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const ID = '@lumine/dsh-chat'
const CSS_VIRTUAL = '\0lumine-css:'
const CSS_SUFFIX = '.mjs'

const EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

function hashLocal(fileId, local) {
  const digest = createHash('sha1').update(`${fileId}:${local}`).digest('hex').slice(0, 6)
  return `${digest}_${local}`
}

function compileModules(fileId, source) {
  const classMap = {}
  const rewritten = source.replace(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g, (match, local) => {
    if (!(local in classMap)) classMap[local] = hashLocal(fileId, local)
    return `.${classMap[local]}`
  })
  return { css: rewritten, classMap }
}

function styleModule(fileId, css, classMap) {
  const tagId = `${ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
    "  const tag = document.createElement('style');",
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    neverBundle: specifier => EXTERNALS.has(specifier),
    alwaysBundle: specifier => !EXTERNALS.has(specifier),
  },
  plugins: [
    {
      name: 'lumine-client-externals',
      resolveId(source) {
        if (EXTERNALS.has(source)) return { id: source, external: true }
        return null
      },
    },
    {
      name: 'lumine-client-dts',
      async writeBundle() {
        const source = await readFile(resolve('src/client/client.d.ts'), 'utf8')
        await writeFile(resolve('lib/client.d.ts'), source)
      },
    },
    {
      name: 'lumine-css-modules',
      resolveId(source, importer) {
        if (!source.endsWith('.module.css') || importer === undefined) return null
        return CSS_VIRTUAL + resolve(dirname(importer), source) + CSS_SUFFIX
      },
      async load(virtualId) {
        if (!virtualId.startsWith(CSS_VIRTUAL)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL.length, -CSS_SUFFIX.length)
        this.addWatchFile?.(fileId)
        const source = await readFile(fileId, 'utf8')
        const { css, classMap } = compileModules(fileId, source)
        return styleModule(fileId, css, classMap)
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
