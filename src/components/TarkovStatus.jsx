function cachedAge(cachedAt) {
  if (!cachedAt) return null
  const days = Math.floor(Math.max(0, Date.now() - cachedAt) / (24 * 60 * 60 * 1000))
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// json.tarkov.dev is the primary source (see constants.js GRAPHQL_ENABLED), so
// serving REST data is normal operation and sets no error at all — nothing renders.
// The `rest` branch below only appears when GraphQL is re-enabled and then loses to
// the fallback; the plain branch means the data source itself failed.
export default function TarkovStatus({ error, retry, cachedAt }) {
  if (!error) return null
  const age = cachedAge(cachedAt)
  const isRestFallback = error.source === 'rest'

  return (
    <div className={`tarkov-status${isRestFallback ? ' tarkov-status-rest' : ''}`} role={isRestFallback ? 'status' : 'alert'}>
      <div>
        {isRestFallback ? (
          <>
            <strong>Using the backup source.</strong> tarkov.dev&apos;s GraphQL API is unavailable; this panel is reading the JSON API instead.
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
