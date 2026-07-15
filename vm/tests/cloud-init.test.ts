// vm/tests/cloud-init.test.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const raw = readFileSync(join(here, '..', 'cloud-init', 'user-data'), 'utf8')

describe('cloud-init user-data', () => {
  it('starts with the cloud-config header', () => {
    expect(raw.split('\n')[0]).toBe('#cloud-config')
  })
  it('is valid YAML and defines the runner user with a pubkey placeholder', () => {
    const doc = parse(raw)
    const runner = doc.users.find((u: any) => u?.name === 'runner')
    expect(runner).toBeTruthy()
    expect(JSON.stringify(runner.ssh_authorized_keys)).toContain('__SSH_PUBKEY__')
    expect(runner.sudo).toContain('NOPASSWD')
  })
  it('disables ssh password auth', () => {
    expect(raw).toContain('ssh_pwauth: false')
  })
})
