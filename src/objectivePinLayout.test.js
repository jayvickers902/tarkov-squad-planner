import { describe, expect, it } from 'vitest'
import { layoutObjectivePins } from './objectivePinLayout'

describe('layoutObjectivePins', () => {
  it('leaves a pin on its exact visual anchor when it is alone', () => {
    expect(layoutObjectivePins([{ id: 'mine', lat: 10, lng: 20 }])[0]).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      overlapCount: 1,
    })
  })

  it('groups squad owners when they share the same objective zone', () => {
    const laidOut = layoutObjectivePins([
      { id: 'mine', key: 'quest::objective', memberId: 'me', memberName: 'JAY', initial: 'J', color: 'red', lat: 10, lng: 20 },
      { id: 'theirs', key: 'quest::objective', memberId: 'them', memberName: 'TLBT', initial: 'T', color: 'blue', lat: 10, lng: 20 },
    ])

    expect(laidOut).toHaveLength(1)
    expect(laidOut[0]).toMatchObject({ offsetX: 0, offsetY: 0, overlapCount: 1 })
    expect(laidOut[0].owners).toEqual([
      { memberId: 'me', memberName: 'JAY', initial: 'J', color: 'red' },
      { memberId: 'them', memberName: 'TLBT', initial: 'T', color: 'blue' },
    ])
  })

  it('fans unrelated objectives apart when they share a coordinate', () => {
    const laidOut = layoutObjectivePins([
      { id: 'a', key: 'quest-a::objective', lat: 10, lng: 20 },
      { id: 'b', key: 'quest-b::objective', lat: 10, lng: 20 },
    ])

    expect(laidOut.map(pin => [pin.offsetX, pin.offsetY])).toEqual([[-9, 0], [9, 0]])
  })
})
