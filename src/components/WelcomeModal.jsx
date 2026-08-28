import { useEffect, useState } from 'react'
import useDialogFocus from '../useDialogFocus'
import { RELEASES, SETUP_STEPS } from '../whatsNew'

export default function WelcomeModal({ variant, onDismiss, onStartQuestSetup }) {
  const [activeVariant, setActiveVariant] = useState(variant)
  const dialogRef = useDialogFocus(true, onDismiss)
  const isSetup = activeVariant === 'setup'
  const release = RELEASES[0]

  useEffect(() => {
    setActiveVariant(variant)
  }, [variant])

  function handleBackdropClick(event) {
    if (event.target === event.currentTarget) onDismiss()
  }

  return (
    <div className="app-confirm-backdrop welcome-backdrop" onClick={handleBackdropClick}>
      <div
        ref={dialogRef}
        className="welcome-dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        aria-describedby="welcome-modal-description"
        tabIndex={-1}
      >
        <div className="welcome-header">
          <div className="mono welcome-kicker">{isSetup ? 'FIRST-RUN SETUP GUIDE' : `${release.version} · ${release.date}`}</div>
          <h2 id="welcome-modal-title">{isSetup ? 'WELCOME TO SQUAD PLANNER' : release.title}</h2>
          <p id="welcome-modal-description" className="mono welcome-intro">
            {isSetup
              ? 'A quick field guide to getting your squad from quest list to raid.'
              : 'The latest changes to your raid-coordination kit.'}
          </p>
        </div>

        <div className="welcome-body">
          {isSetup ? (
            <ol className="welcome-steps">
              {SETUP_STEPS.map((step, index) => (
                <li className="welcome-step" key={step.title}>
                  <span className="welcome-step-number mono">{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="welcome-release-items">
              {release.items.map(item => (
                <div className="welcome-release-item" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
              <button className="welcome-link mono" onClick={() => setActiveVariant('setup')} type="button">
                SETUP GUIDE
              </button>
            </div>
          )}
        </div>

        <div className="welcome-actions">
          {isSetup && (
            <button className="btn-ghost" onClick={onDismiss} type="button">
              DO THIS LATER
            </button>
          )}
          <button
            data-autofocus
            className="btn-gold"
            onClick={isSetup ? (onStartQuestSetup || onDismiss) : onDismiss}
            type="button"
          >
            {isSetup ? 'SET UP QUESTS' : 'GOT IT'}
          </button>
        </div>
      </div>
    </div>
  )
}
