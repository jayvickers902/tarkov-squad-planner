import { describe, expect, it } from 'vitest'
import { classifyObjective, classifyTask, objectiveShare, taskShare } from './questShare'
import tasksPayload from './data/prebaked/tasks.json'

describe('quest shareability classifier', () => {
  it('maps world-action types to squad and inventory/profile types to personal', () => {
    for (const type of ['shoot', 'visit', 'plantItem', 'plantQuestItem', 'mark', 'extract', 'useItem']) {
      expect(classifyObjective({ type })).toBe('squad')
    }
    for (const type of ['giveItem', 'findItem', 'findQuestItem', 'giveQuestItem', 'buildWeapon', 'skill', 'traderLevel', 'traderStanding', 'sellItem', 'experience', 'taskStatus', 'dialogue', 'globalVariable']) {
      expect(classifyObjective({ type })).toBe('personal')
    }
  })

  it('lets FIR and task overrides win conservatively', () => {
    const task = { id: 'task-1', objectives: [{ type: 'shoot', foundInRaid: true }] }
    expect(classifyObjective(task.objectives[0], task)).toBe('personal')
    expect(classifyObjective({ type: 'shoot' }, task, { 'task-1': { verdict: 'solo' } })).toBe('personal')
    expect(classifyTask(task, { 'task-1': { verdict: 'shared' } })).toBe('shared')
  })

  it('rolls required objectives up to shared, partial, or solo', () => {
    expect(classifyTask({ objectives: [{ type: 'shoot' }, { type: 'visit' }] })).toBe('shared')
    expect(classifyTask({ objectives: [{ type: 'shoot' }, { type: 'giveItem' }] })).toBe('partial')
    expect(classifyTask({ objectives: [{ type: 'giveItem' }] })).toBe('solo')
    expect(classifyTask({ objectives: [{ type: 'shoot', optional: true }] })).toBe('solo')
  })

  it('lets a partial override keep per-objective type rules', () => {
    // `shared` and `solo` are absolute; `partial` must not flatten a mixed task,
    // or it renders exactly like `solo` and the verdict carries no information.
    const task = {
      id: 'task-2',
      objectives: [{ type: 'shoot' }, { type: 'giveItem' }],
    }
    const overrides = { 'task-2': { verdict: 'partial' } }
    expect(classifyTask(task, overrides)).toBe('partial')
    expect(classifyObjective(task.objectives[0], task, overrides)).toBe('squad')
    expect(classifyObjective(task.objectives[1], task, overrides)).toBe('personal')

    const solo = { 'task-2': { verdict: 'solo' } }
    expect(classifyObjective(task.objectives[0], task, solo)).toBe('personal')
  })

  it('accepts overrides as a Map and ignores unknown verdicts', () => {
    const task = { id: 'task-3', objectives: [{ type: 'shoot' }] }
    expect(classifyTask(task, new Map([['task-3', { verdict: 'solo' }]]))).toBe('solo')
    expect(classifyTask(task, { 'task-3': { verdict: 'nonsense' } })).toBe('shared')
  })

  it('uses safe defaults for malformed and unknown input', () => {
    expect(classifyObjective(null)).toBe('personal')
    expect(classifyObjective({}, {})).toBe('personal')
    expect(classifyTask(null)).toBe('solo')
    expect(classifyTask({})).toBe('solo')
    expect(classifyObjective({ type: 'newUpstreamType' })).toBe('personal')
  })

  it('keeps the committed task roll-up in a sane band', () => {
    const tasks = tasksPayload.data
    const totals = tasks.reduce((counts, task) => {
      counts[classifyTask(task)] += 1
      return counts
    }, { shared: 0, partial: 0, solo: 0 })
    expect(totals.shared / tasks.length).toBeGreaterThan(0.35)
    expect(totals.shared / tasks.length).toBeLessThan(0.55)
    expect(totals.shared + totals.partial + totals.solo).toBe(tasks.length)
  })
})

describe('curated per-objective verdicts', () => {
  // Consolation Prize is the case that motivated per-objective data: both
  // objectives are squad-typed, so the inference rolls the task up to `shared`,
  // but only the kill count is actually cooperative.
  const task = {
    id: 'consolation',
    objectives: [
      { id: 'obj-extract', type: 'extract' },
      { id: 'obj-kill', type: 'shoot' },
    ],
  }
  const overrides = {
    consolation: {
      verdict: 'partial',
      source: 'tarkov.help',
      objectives: { 'obj-extract': 'personal', 'obj-kill': 'squad' },
    },
  }

  it('corrects an objective the type rule gets wrong', () => {
    expect(classifyTask(task, {})).toBe('shared')
    expect(classifyObjective(task.objectives[0], task, {})).toBe('squad')

    expect(classifyTask(task, overrides)).toBe('partial')
    expect(classifyObjective(task.objectives[0], task, overrides)).toBe('personal')
    expect(classifyObjective(task.objectives[1], task, overrides)).toBe('squad')
  })

  it('lets a named objective outrank an absolute task verdict', () => {
    const shared = {
      consolation: { verdict: 'shared', objectives: { 'obj-extract': 'personal' } },
    }
    expect(classifyObjective(task.objectives[0], task, shared)).toBe('personal')
    expect(classifyObjective(task.objectives[1], task, shared)).toBe('squad')
  })

  it('ignores unknown objective verdicts and objectives without an id', () => {
    const junk = { consolation: { verdict: 'partial', objectives: { 'obj-kill': 'maybe' } } }
    expect(classifyObjective(task.objectives[1], task, junk)).toBe('squad') // falls back to type
    expect(classifyObjective({ type: 'shoot' }, task, overrides)).toBe('squad') // no id to match
  })
})

describe('share provenance gates the badge', () => {
  const task = { id: 'task-9', objectives: [{ id: 'o1', type: 'shoot' }] }

  it('reports an inferred verdict as uncurated', () => {
    // This is the whole point: the inference still answers, but says it is a
    // guess, so the UI renders no badge for it.
    expect(taskShare(task, {})).toMatchObject({ verdict: 'shared', curated: false, source: null })
    expect(objectiveShare(task.objectives[0], task, {}))
      .toMatchObject({ verdict: 'squad', curated: false, source: null })
  })

  it('reports a curated verdict with its source', () => {
    const overrides = { 'task-9': { verdict: 'shared', source: 'tarkov.help' } }
    expect(taskShare(task, overrides)).toMatchObject({ verdict: 'shared', curated: true, source: 'tarkov.help' })
    expect(objectiveShare(task.objectives[0], task, overrides))
      .toMatchObject({ verdict: 'squad', curated: true, source: 'tarkov.help' })
  })

  it('treats a partial task with no entry for the objective as inferred', () => {
    // The task is curated, but `partial` deliberately falls through to the type
    // rule for objectives it does not name — so that objective stays a guess.
    const overrides = { 'task-9': { verdict: 'partial', source: 'tarkov.help' } }
    expect(taskShare(task, overrides).curated).toBe(true)
    const objective = objectiveShare(task.objectives[0], task, overrides)
    expect(objective).toMatchObject({ verdict: 'squad', curated: false, source: null })
  })

  it('marks an objective curated once the partial row names it', () => {
    const overrides = {
      'task-9': { verdict: 'partial', source: 'tarkov.help', objectives: { o1: 'personal' } },
    }
    expect(objectiveShare(task.objectives[0], task, overrides))
      .toMatchObject({ verdict: 'personal', curated: true, source: 'tarkov.help' })
  })
})

describe('community tier', () => {
  // `giveItem` infers to personal, so any 'squad' result here can only have come
  // from the tallies — the inference could never produce it on its own.
  const task = {
    id: 'task-c',
    objectives: [{ id: 'o1', type: 'giveItem' }, { id: 'o2', type: 'giveItem' }],
  }
  const tally = counts => ({ 'task-c': counts })

  it('promotes a tally that clears the reports and agreement thresholds', () => {
    const tallies = tally({ o1: { squad: 2, personal: 0 } })
    expect(objectiveShare(task.objectives[0], task, {}, tallies)).toMatchObject({
      verdict: 'squad', tier: 'community', curated: false, source: 'community',
    })
  })

  it('ignores a lone report, so one person cannot set everyone else s badge', () => {
    const tallies = tally({ o1: { squad: 1, personal: 0 } })
    const share = objectiveShare(task.objectives[0], task, {}, tallies)
    expect(share).toMatchObject({ verdict: 'personal', tier: 'inferred' })
    // The counts still ride along so the UI can show "1 report" next to the vote.
    expect(share.counts).toEqual({ squad: 1, personal: 0, total: 1 })
  })

  it('ignores a tally that has the reports but not the agreement', () => {
    expect(classifyObjective(task.objectives[0], task, {}, tally({ o1: { squad: 1, personal: 1 } })))
      .toBe('personal')
    // 2-1 clears exactly two thirds and stands.
    expect(classifyObjective(task.objectives[0], task, {}, tally({ o1: { squad: 2, personal: 1 } })))
      .toBe('squad')
    // 2-2 does not.
    expect(classifyObjective(task.objectives[0], task, {}, tally({ o1: { squad: 2, personal: 2 } })))
      .toBe('personal')
  })

  it('lets a curated verdict outrank the community, however many reports agree', () => {
    const overrides = { 'task-c': { verdict: 'solo', source: 'tarkov.help' } }
    const tallies = tally({ o1: { squad: 40, personal: 0 } })
    expect(objectiveShare(task.objectives[0], task, overrides, tallies)).toMatchObject({
      verdict: 'personal', tier: 'curated', source: 'tarkov.help',
    })
  })

  it('fills the gap a partial override deliberately leaves open', () => {
    // `partial` names one objective and lets the other fall through — that fall
    // through now lands on the community tier before it lands on inference.
    const overrides = { 'task-c': { verdict: 'partial', objectives: { o2: 'personal' } } }
    const tallies = tally({ o1: { squad: 3, personal: 0 } })
    expect(objectiveShare(task.objectives[0], task, overrides, tallies).tier).toBe('community')
    expect(objectiveShare(task.objectives[1], task, overrides, tallies).tier).toBe('curated')
  })

  it('only calls a task community-backed when every objective is', () => {
    const partial = tally({ o1: { squad: 2, personal: 0 } })
    expect(taskShare(task, {}, partial)).toMatchObject({ verdict: 'partial', tier: 'inferred' })

    const full = tally({ o1: { squad: 2, personal: 0 }, o2: { squad: 2, personal: 0 } })
    expect(taskShare(task, {}, full)).toMatchObject({ verdict: 'shared', tier: 'community' })
  })

  it('survives missing, empty and malformed tallies', () => {
    for (const tallies of [null, undefined, {}, tally({}), tally({ o1: null }), tally({ o1: {} })]) {
      expect(classifyObjective(task.objectives[0], task, {}, tallies)).toBe('personal')
    }
    expect(classifyObjective(task.objectives[0], task, {}, new Map([['task-c', { o1: { squad: 2, personal: 0 } }]])))
      .toBe('squad')
  })
})
