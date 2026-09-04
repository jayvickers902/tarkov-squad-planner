import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const appOrigin = new URL('http://127.0.0.1:4173').origin

  // The preview is intentionally offline from application services. Aborting
  // every non-preview request catches accidental dependence on Supabase,
  // tarkov.dev, or remote fonts while keeping the app shell deterministic.
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === appOrigin) return route.continue()
    return route.abort()
  })
})

test('renders the unauthenticated shell and navigates through the lazy changelog chunk', async ({ page }) => {
  const changelogChunk = page.waitForRequest(request => /\/assets\/Changelog-[^/]+\.js$/.test(new URL(request.url()).pathname))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'SQUAD PLANNER' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'JOIN YOUR SQUAD' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })).toBeEnabled()
  await expect(page.getByRole('link', { name: 'CHANGELOG' })).toBeVisible()

  await page.getByRole('link', { name: 'CHANGELOG' }).click()
  await expect(page).toHaveURL(/\/changelog$/)
  await expect(page.getByRole('heading', { name: 'CHANGELOG' })).toBeVisible()
  await changelogChunk
})

test('keeps the auth shell usable at a narrow responsive viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'JOIN YOUR SQUAD' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'CONTINUE WITH GOOGLE' })).toBeEnabled()

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
})

test('keeps the changelog usable at a narrow responsive viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/changelog')

  await expect(page.getByRole('heading', { name: 'CHANGELOG' })).toBeVisible()

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
})
