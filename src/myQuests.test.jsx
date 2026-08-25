import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) },
}))
vi.mock('./useTarkov', () => ({ useTasks: () => ({ tasks: [], loading: false }) }))

import MyQuests from './components/MyQuests'

// MyQuests had no render coverage, which let a temporal-dead-zone reference
// (snapKey reading gameMode before its declaration) reach the working tree while
// the build and 38 other tests stayed green. This renders the real component.
describe('MyQuests render smoke', () => {
  it('renders for a signed-in user without throwing', () => {
    render(
      <MyQuests
        userId="user-1"
        userQuests={[]}
        onAdd={() => {}}
        onBulkAdd={() => {}}
        onRemove={() => {}}
        onToggleImportant={() => {}}
        onToggleSkipped={() => {}}
        onClearAll={() => {}}
        onRestore={() => {}}
        onDone={() => {}}
        inParty={false}
        userSettings={{}}
        onSetUserSetting={() => {}}
        gameMode="regular"
      />,
    )
    expect(true).toBe(true)
  })
})
