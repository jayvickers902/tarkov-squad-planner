import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compactObjectiveMapReferences } from './tarkovRest'

const fixturePath = resolve(process.cwd(), 'src/test/fixtures/tasks-before-map-flattening.json.gz')
const legacyPayload = JSON.parse(gunzipSync(readFileSync(fixturePath), { encoding: 'utf8' }))

function mapReferences(tasks) {
  const byName = new Map()
  for (const task of tasks) {
    for (const objective of task.objectives || []) {
      for (const reference of objective.maps || []) add(reference)
      for (const zone of objective.zones || []) add(zone.map)
    }
  }
  return byName

  function add(reference) {
    if (!reference) return
    const previous = byName.get(reference.normalizedName)
    if (previous) expect(reference).toEqual(previous)
    else byName.set(reference.normalizedName, reference)
  }
}

function expandObjectiveMapReferences(objective, mapsByName) {
  const expand = name => name == null ? null : mapsByName.get(name)
  return {
    ...objective,
    maps: objective.maps.map(expand),
    zones: objective.zones.map(zone => ({ ...zone, map: expand(zone.map) })),
  }
}

describe('prebaked task map-reference shape', () => {
  it('round-trips every legacy task record through the compact shape without losing a field', () => {
    const mapsByName = mapReferences(legacyPayload.data)
    let objectiveCount = 0
    let referenceCount = 0

    for (const legacyTask of legacyPayload.data) {
      const compactTask = {
        ...legacyTask,
        objectives: legacyTask.objectives.map(objective => {
          objectiveCount += 1
          referenceCount += objective.maps.length + objective.zones.filter(zone => zone.map).length
          return compactObjectiveMapReferences(objective)
        }),
      }
      const roundTrippedTask = {
        ...compactTask,
        objectives: compactTask.objectives.map(objective => expandObjectiveMapReferences(objective, mapsByName)),
      }

      expect(roundTrippedTask).toEqual(legacyTask)
    }

    // Pin the proof to the complete pre-flattening catalog. A partial fixture
    // or a transform that silently skips records must not make this test green.
    expect(legacyPayload.data).toHaveLength(517)
    expect(objectiveCount).toBe(1457)
    expect(referenceCount).toBe(2123)
    expect(mapsByName.size).toBe(16)
  })
})
