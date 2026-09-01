import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(repoRoot, 'companion', 'src-tauri', 'tauri.conf.json')
const appVersion = JSON.parse(fs.readFileSync(configPath, 'utf8')).version
const artifactDir = path.resolve(repoRoot, process.argv[2] || 'release')
const tag = process.argv[3] || process.env.GITHUB_REF_NAME || `companion-v${appVersion}`

const architectures = Object.freeze({
  x64: 'windows-x86_64',
  x86: 'windows-i686',
})

function fail(message) {
  throw new Error(`Companion release validation failed: ${message}`)
}

export function validateReleaseTag(releaseTag = tag, version = appVersion) {
  if (!/^companion-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseTag)) fail(`tag ${releaseTag} is not a companion-vX.Y.Z tag`)
  const tagVersion = releaseTag.slice('companion-v'.length)
  if (tagVersion !== version) fail(`tag ${releaseTag} does not match configured version ${version}`)
}

export function buildManifest({ version = appVersion, releaseTag = tag, directory = artifactDir, notes = 'Signed updater release for Windows.' } = {}) {
  validateReleaseTag(releaseTag, version)
  const platforms = {}

  for (const [label, architecture] of Object.entries(architectures)) {
    const installerName = `Tarkov-Squad-Planner-Companion_${label}-setup.exe`
    const signatureName = `${installerName}.sig`
    const msiName = `Tarkov-Squad-Planner-Companion_${label}.msi`
    const signature = readArtifactFrom(directory, signatureName)
    readArtifactFrom(directory, installerName)
    readArtifactFrom(directory, msiName)
    const url = `https://github.com/jayvickers902/tarkov-squad-planner/releases/download/${releaseTag}/${installerName}`
    platforms[architecture] = { url, signature: signature.toString('utf8').trim() }
  }

  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  }
  validateManifest(manifest, { version, releaseTag, directory })
  return manifest
}

function readArtifactFrom(directory, name) {
  const artifactPath = path.join(directory, name)
  if (!fs.existsSync(artifactPath)) fail(`missing ${name}`)
  return fs.readFileSync(artifactPath)
}

export function validateManifest(manifest, { version = appVersion, releaseTag = tag, directory = artifactDir } = {}) {
  validateReleaseTag(releaseTag, version)
  if (!manifest || manifest.version !== version) fail(`manifest version ${manifest?.version || '<missing>'} does not match ${version}`)
  if (typeof manifest.notes !== 'string' || manifest.notes.length === 0) fail('manifest notes are missing')
  if (Number.isNaN(Date.parse(manifest.pub_date))) fail('manifest pub_date is invalid')

  const expectedArchitectures = Object.values(architectures).sort()
  const actualArchitectures = Object.keys(manifest.platforms || {}).sort()
  if (JSON.stringify(actualArchitectures) !== JSON.stringify(expectedArchitectures)) fail(`manifest architectures are ${actualArchitectures.join(', ') || '<missing>'}`)

  for (const [label, architecture] of Object.entries(architectures)) {
    const entry = manifest.platforms[architecture]
    const installerName = `Tarkov-Squad-Planner-Companion_${label}-setup.exe`
    const expectedUrl = `https://github.com/jayvickers902/tarkov-squad-planner/releases/download/${releaseTag}/${installerName}`
    if (entry.url !== expectedUrl) fail(`${architecture} URL is invalid`)
    if (typeof entry.signature !== 'string' || entry.signature.trim().length < 20) fail(`${architecture} signature is missing`)
    const signatureOnDisk = readArtifactFrom(directory, `${installerName}.sig`).toString('utf8').trim()
    if (entry.signature.trim() !== signatureOnDisk) fail(`${architecture} signature does not match its staged artifact`)
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const manifestPath = path.join(artifactDir, 'latest.json')
  const manifest = buildManifest()
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  console.log(`Validated ${manifestPath} for ${tag}`)
}
