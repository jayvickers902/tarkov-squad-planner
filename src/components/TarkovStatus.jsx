function cachedAge(cachedAt) {
  if (!cachedAt) return null
  const days = Math.floor(Math.max(0, Date.now() - cachedAt) / (24 * 60 * 60 * 1000))
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function TarkovStatus({ error, retry, cachedAt }) {
  if (!error) return null
  const age = cachedAge(cachedAt)
  const isRestFallback = error.source === 'rest'

  return (
    <div className={`tarkov-status${isRestFallback ? ' tarkov-status-rest' : ''}`} role={isRestFallback ? 'status' : 'alert'}>
      <div>
        {isRestFallback ? (
          <>
            <strong>Showing backup data.</strong> tarkov.dev&apos;s main API is down; this panel is using the backup JSON API. Some details may be missing.
          </>
        ) : (
          <>
            <strong>Tarkov.dev is unavailable.</strong> Quest, key, map, and boss data comes from the community tarkov.dev API, which is currently down.
          </>
        )}
      </div>
      {isRestFallback && error.fromCache && age && <div className="tarkov-status-cache">Showing data cached {age}.</div>}
      {!isRestFallback && age && <div className="tarkov-status-cache">Showing data cached {age}.</div>}
      <button className="btn-ghost btn-sm" onClick={retry}>RETRY</button>
    </div>
  )
}
