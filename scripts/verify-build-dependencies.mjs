import { readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredVersions = new Map([
  ['nanoid', '3.3.18'],
  ['postcss', '8.5.26'],
  ['vite', '8.2.2'],
])

const observed = new Map([...requiredVersions].map(([name]) => [name, new Set()]))
const visitedPackages = new Set()

async function inspectPackage(packageDirectory) {
  let canonicalDirectory
  try {
    canonicalDirectory = await realpath(packageDirectory)
  } catch {
    return
  }

  if (visitedPackages.has(canonicalDirectory)) return
  visitedPackages.add(canonicalDirectory)

  try {
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'))
    if (requiredVersions.has(manifest.name)) {
      observed.get(manifest.name).add(`${manifest.version} at ${packageDirectory}`)
    }
  } catch {
    // A node_modules directory may contain implementation folders that are not packages.
  }

  await inspectNodeModules(join(packageDirectory, 'node_modules'))
}

async function inspectNodeModules(nodeModulesDirectory) {
  let entries
  try {
    entries = await readdir(nodeModulesDirectory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.name === '.bin' || (!entry.isDirectory() && !entry.isSymbolicLink())) continue

    const entryPath = join(nodeModulesDirectory, entry.name)
    if (!entry.name.startsWith('@')) {
      await inspectPackage(entryPath)
      continue
    }

    let scopedEntries
    try {
      scopedEntries = await readdir(entryPath, { withFileTypes: true })
    } catch {
      continue
    }

    for (const scopedEntry of scopedEntries) {
      if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
        await inspectPackage(join(entryPath, scopedEntry.name))
      }
    }
  }
}

await inspectNodeModules(fileURLToPath(new URL('../node_modules/', import.meta.url)))

const failures = []
for (const [name, requiredVersion] of requiredVersions) {
  const installations = [...observed.get(name)].sort()
  if (installations.length === 0) {
    failures.push(`${name}: not installed`)
    continue
  }

  const wrongVersions = installations.filter(installation => !installation.startsWith(`${requiredVersion} at `))
  if (wrongVersions.length > 0) {
    failures.push(`${name}: expected only ${requiredVersion}; found ${wrongVersions.join(', ')}`)
  }
}

if (failures.length > 0) {
  throw new Error(`unsafe build dependency graph:\n${failures.join('\n')}`)
}

console.log(
  `verified build dependencies: ${[...requiredVersions].map(([name, version]) => `${name}@${version}`).join(', ')}`,
)
