import { describe, expect, it, vi } from 'vitest'
import {
  classifyChangedEftLogMetadata,
  classifyEftLogFileChange,
  changedEftLogMetadata,
  enumerateRelevantEftLogFiles,
  getRelevantEftLogFiles,
  haveEftLogFilesChanged,
  MAX_RELEVANT_FILE_BYTES,
  readRelevantEftLogFiles,
  readEftLogAppend,
} from './eftLogDirectory'

function file(name, text = '{}', extra = {}) {
  return {
    name,
    size: new TextEncoder().encode(text).byteLength,
    lastModified: 1,
    async text() { return text },
    ...extra,
  }
}

describe('eft log directory helpers', () => {
  it('uses webkitRelativePath and filters to parser-approved logs before reading', async () => {
    const irrelevant = file('ignored.log', 'must not be read', { text: vi.fn(async () => 'must not be read') })
    const relevant = file('session/notifications.log', '{}', { webkitRelativePath: 'Logs/session/notifications.log' })

    const entries = getRelevantEftLogFiles([irrelevant, relevant])
    expect(entries.map(entry => entry.relativeFilename)).toEqual(['Logs/session/notifications.log'])
    const files = await readRelevantEftLogFiles([irrelevant, relevant])
    expect(files).toHaveLength(1)
    expect(irrelevant.text).not.toHaveBeenCalled()
  })

  it('rejects a relevant file over the cap before reading it', async () => {
    const tooLarge = file('notifications.log', 'not read', { size: MAX_RELEVANT_FILE_BYTES + 1, text: vi.fn() })
    await expect(readRelevantEftLogFiles([tooLarge])).rejects.toMatchObject({ code: 'EFT_LOG_FILE_TOO_LARGE' })
    expect(tooLarge.text).not.toHaveBeenCalled()
  })

  it('recursively enumerates metadata while ignoring unrelated files', async () => {
    const relevant = file('notifications.log', '{}')
    const getFile = vi.fn(async () => relevant)
    const root = {
      kind: 'directory',
      async *values() {
        yield { kind: 'directory', name: 'session', async *values() {
          yield { kind: 'file', name: 'notifications.log', getFile }
          yield { kind: 'file', name: 'screenshot.png', getFile: vi.fn() }
        } }
      },
    }

    const entries = await enumerateRelevantEftLogFiles(root)
    expect(entries).toMatchObject([{ relativeFilename: 'session/notifications.log', size: 2 }])
    expect(getFile).toHaveBeenCalledOnce()
  })

  it('detects additions, rotation, shrinkage, and removals using only metadata', () => {
    const oldFiles = [{ relativeFilename: 'notifications.log', size: 10, lastModified: 1 }]
    expect(haveEftLogFilesChanged(oldFiles, oldFiles)).toBe(false)
    expect(haveEftLogFilesChanged(oldFiles, [{ ...oldFiles[0], size: 3, lastModified: 2 }])).toBe(true)
    expect(haveEftLogFilesChanged(oldFiles, [])).toBe(true)
    expect(changedEftLogMetadata(oldFiles, [
      { ...oldFiles[0], size: 3, lastModified: 2 },
      { relativeFilename: 'push-notifications_1.log', size: 4, lastModified: 1 },
    ])).toHaveLength(2)
  })

  it('classifies unchanged, append, shrink, rotation, and new files', () => {
    const old = { relativeFilename: 'notifications.log', size: 10, lastModified: 1 }
    expect(classifyEftLogFileChange(old, old)).toBe('unchanged')
    expect(classifyEftLogFileChange(old, { ...old, size: 12, lastModified: 2 })).toBe('append')
    expect(classifyEftLogFileChange(old, { ...old, size: 3, lastModified: 3 })).toBe('shrink')
    expect(classifyEftLogFileChange(old, { ...old, lastModified: 2 })).toBe('changed')
    expect(classifyEftLogFileChange(null, old)).toBe('new')
    expect(classifyChangedEftLogMetadata(old ? [old] : [], [{ ...old, size: 12 }])[0].change).toBe('append')
  })

  it('reads only appended bytes and falls back to a full read on rotation', async () => {
    const content = '0123456789abcdef'
    const current = file('notifications.log', content, { size: content.length, slice(start) {
      const suffix = content.slice(start)
      return { async arrayBuffer() { return new TextEncoder().encode(suffix).buffer } }
    } })
    const append = await readEftLogAppend({ ...current, relativeFilename: 'notifications.log' }, {
      relativeFilename: 'notifications.log', size: 10, lastModified: 1,
    })
    expect(append.change).toBe('append')
    expect(append.text).toBe('abcdef')
    expect(append.readOffset).toBe(10)
    const rotated = await readEftLogAppend({ ...current, relativeFilename: 'notifications.log' }, {
      relativeFilename: 'notifications.log', size: 20, lastModified: 1,
    })
    expect(rotated.change).toBe('shrink')
    expect(rotated.requiresFullRead).toBe(true)
    expect(rotated.text).toBe(content)
  })

  it('does not read beyond the total cap when metadata is available', async () => {
    const first = file('one/notifications.log', 'a'.repeat(5), { size: 5, text: vi.fn(async () => 'a'.repeat(5)) })
    const second = file('two/notifications.log', 'b'.repeat(5), { size: 5, text: vi.fn(async () => 'b'.repeat(5)) })
    await expect(readRelevantEftLogFiles([first, second], { maxTotalBytes: 9 })).rejects.toMatchObject({ code: 'EFT_LOG_TOTAL_TOO_LARGE' })
    expect(first.text).not.toHaveBeenCalled()
    expect(second.text).not.toHaveBeenCalled()
  })
})
