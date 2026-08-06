function cachedAge(cachedAt) {
  if (!cachedAt) return null
  const days = Math.floor(Math.max(0, Date.now() - cachedAt) / (24 * 60 * 60 * 1000))
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export default function TarkovStatus({ error, retry, cachedAt }) {
  if (!error) return null
  const age = cachedAge(cachedAt)

  return (
    <div className="tarkov-status" role="alert">
      <div>
        <strong>Tarkov.dev is unavailable.</strong> Quest, key, map, and boss data comes from the community tarkov.dev API, which is currently down.
      </div>
      {age && <div className="tarkov-status-cache">Showing data cached {age}.</div>}
      <button className="btn-ghost btn-sm" onClick={retry}>RETRY</button>
    </div>
  )
}
