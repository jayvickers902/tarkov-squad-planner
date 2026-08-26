export const WELCOME_SETTINGS_KEY = 'welcome'

function welcomeState(settings) {
  const state = settings?.[WELCOME_SETTINGS_KEY]
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {}
}

// -> 'setup' | 'news' | null
export function resolveWelcomeVariant({
  settings,
  settingsLoading,
  isNewProfile,
  releaseVersion,
}) {
  if (settingsLoading) return null
  if (isNewProfile) return 'setup'
  if (welcomeState(settings).news_version === releaseVersion) return null
  return 'news'
}

export function welcomeStamp(variant, releaseVersion, nowIso, previous) {
  const prior = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? previous
    : {}

  if (variant === 'setup') {
    return {
      ...prior,
      setup_seen_at: nowIso,
      news_version: releaseVersion,
    }
  }

  if (variant === 'news') {
    return {
      ...prior,
      news_version: releaseVersion,
    }
  }

  return { ...prior }
}
