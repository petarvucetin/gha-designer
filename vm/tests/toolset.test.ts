// vm/tests/toolset.test.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = parse(readFileSync(join(here, '..', 'toolset.yaml'), 'utf8'))

describe('toolset manifest', () => {
  it('pins act to 0.2.89', () => {
    expect(manifest.act.version).toBe('0.2.89')
  })
  it('lists the practical-subset apt packages', () => {
    for (const p of ['git', 'curl', 'jq', 'build-essential', 'ca-certificates', 'openssh-client'])
      expect(manifest.apt).toContain(p)
  })
  it('declares node, python, gh and docker', () => {
    expect(manifest.tools.node.version).toBe('20')
    expect(manifest.tools.python.version).toBe('3.12')
    expect(manifest.tools.gh).toBeDefined()
    expect(manifest.tools.docker).toBe(true)
  })
})
