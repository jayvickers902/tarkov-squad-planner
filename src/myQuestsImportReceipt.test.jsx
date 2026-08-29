import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let latestHubProps = null

vi.mock('./useTarkov', () => ({ useTasks: () => ({ tasks: [], loading: false }) }))
vi.mock('./EftLogSyncContext', () => ({ useEftLogSync: () => ({ allTasks: [] }) }))
vi.mock('./useCompanionSyncStatus', () => ({ useCompanionSyncStatus: () => null }))
vi.mock('./components/EftScreenshotPings', () => ({ default: () => null }))
vi.mock('./components/DesktopAppCard', () => ({ default: () => null }))
vi.mock('./components/QuestImportHub', () => ({
  default: props => {
    latestHubProps = props
    return props.open
      ? (
          <button
            type="button"
            onClick={async () => {
              await props.onImportStart({ source: 'logs' })
              props.onImportComplete({
                source: 'logs',
                questIds: ['quest-new'],
                applied: 1,
                states: { active: 1, failed: 0, completed: 0 },
              })
            }}
          >SIMULATE IMPORT</button>
        )
      : <button type="button" onClick={() => props.onOpenChange(true)}>GET YOUR QUESTS IN</button>
  },
}))

import MyQuests from './components/MyQuests'

afterEach(() => {
  latestHubProps = null
  cleanup()
})

describe('MyQuests import receipt', () => {
  it('keeps a receipt until undo, restores full history, then collapses back to the zero state', async () => {
    const history = [
      { quest_id: 'quest-active', quest_name: 'Active quest', state: 'active' },
      { quest_id: 'quest-complete', quest_name: 'Completed quest', state: 'completed', state_source: 'log_import' },
    ]
    const onRestore = vi.fn().mockResolvedValue(undefined)
    const onGetQuestHistory = vi.fn().mockResolvedValue(history)
    render(
      <MyQuests
        userId="user-1"
        userQuests={[]}
        onAdd={vi.fn()}
        onBulkAdd={vi.fn()}
        onRemove={vi.fn()}
        onToggleImportant={vi.fn()}
        onToggleSkipped={vi.fn()}
        onClearAll={vi.fn()}
        onRestore={onRestore}
        onDone={vi.fn()}
        inParty={false}
        userSettings={{}}
        onSetUserSetting={vi.fn()}
        onGetQuestHistory={onGetQuestHistory}
        gameMode="regular"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'GET YOUR QUESTS IN' }))
    expect(latestHubProps.open).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'SIMULATE IMPORT' }))

    expect(await screen.findByText('IMPORT COMPLETE')).toBeInTheDocument()
    expect(screen.getByText(/1 quest state updated · 1 started/)).toBeInTheDocument()
    expect(screen.getByText('ADD QUEST TO YOUR LIST')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'UNDO IMPORT' }))

    // 'all' scope: the undo point is the complete history, so rows absent
    // from it were created by the import and must be pruned.
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(history, { scope: 'all' }))
    await waitFor(() => expect(screen.queryByText('IMPORT COMPLETE')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'GET YOUR QUESTS IN' })).toBeInTheDocument()
    expect(screen.queryByText('ADD QUEST TO YOUR LIST')).not.toBeInTheDocument()
  })
})
