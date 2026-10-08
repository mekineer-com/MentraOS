#!/usr/bin/env zx

import "zx/globals"
import {constants} from "fs"
import {copyFile, readFile, writeFile} from "fs/promises"
import {setBuildEnv} from './set-build-env.mjs';
import {syncAutolinkingCache} from './clear-autolinking-cache.mjs';
import {VARIANT_RE, resolveAndroidPackageName} from './android-package-name.cjs';
import {CLOUDS} from '../../.github/scripts/prepare-mobile-release-env.mjs';

// build only for real devices new arch:
process.env.ORG_GRADLE_PROJECT_reactNativeArchitectures = 'arm64-v8a'

// Optional --name <suffix> — produces a parallel-installable build with a
// suffixed package name and matching app label. Validation lives in
// app.config.ts (which reads MENTRAOS_BUILD_NAME). e.g.
//   bun android-release --name stable
//   → applicationId: com.mentra.mentra.stable
//   → app label:     stable
// Set the suffix before setBuildEnv / prebuild so react-native.config.js and
// app.config.ts agree on the package. Autolinking is checked once, after
// prebuild, so a stale base-package cache cannot survive into assembleRelease.
const nameSuffix = argv.name ? String(argv.name).trim() : null
if (argv.name !== undefined && (!nameSuffix || !VARIANT_RE.test(nameSuffix))) {
  throw new Error('Invalid --name build variant')
}
if (nameSuffix) {
  process.env.MENTRAOS_BUILD_NAME = nameSuffix
}
for (let number = 1; ; number++) {
  try {
    await copyFile('.env', number === 1 ? '.env.orig' : `.env${number}.orig`, constants.COPYFILE_EXCL)
    break
  } catch (error) {
    if (error.code === 'ENOENT') break
    if (error.code !== 'EEXIST') throw error
  }
}
await setBuildEnv({syncAutolinking: false});
const isOpenAlmaBuild = resolveAndroidPackageName().endsWith('.openalma')
const forkPackage = 'com.mentra.mentra.openalma'
if (isOpenAlmaBuild && !process.env.MENTRA_COORDINATED_RELEASE_CHANNEL && !process.env.MENTRAOS_NATIVE_MARKETING_VERSION) {
  const {version} = JSON.parse(await readFile('../package.json', 'utf-8'))
  const releaseEnv = {
    EXPO_PUBLIC_MENTRAOS_VERSION: version,
    EXPO_PUBLIC_BUILD_ENV: 'prod',
    EXPO_PUBLIC_CLOUD_CORE_URL: CLOUDS.prod.core,
    EXPO_PUBLIC_CLOUD_RUNTIME_URL: CLOUDS.prod.runtime,
  }
  let env = await readFile('.env', 'utf-8')
  for (const [key, value] of Object.entries(releaseEnv)) {
    process.env[key] = value
    env = env.replace(new RegExp(`^${key}=.*\\r?\\n?`, 'gm'), '') + `\n${key}=${value}\n`
  }
  await writeFile('.env', env)
}

console.log('Building Android release...');
if (nameSuffix) {
  console.log(`  Variant: MENTRAOS_BUILD_NAME=${nameSuffix}`)
}

// Prebuild Android (reads MENTRAOS_BUILD_NAME via app.config.ts)
await $({ stdio: 'inherit' })`bun expo prebuild --platform android`;
if (isOpenAlmaBuild) {
  const gradle = await readFile('android/app/build.gradle', 'utf-8')
  if (!new RegExp(`applicationId\\s+['"]${forkPackage.replaceAll('.', '\\.')}['"]`).test(gradle)) {
    throw new Error(`Generated Android release must use ${forkPackage}`)
  }
}

// Authoritative post-prebuild guard (same as android.mjs): compare the resolved
// graph and generated applicationId to the cached artifact, then wipe if a
// suffix / region switch left ReactNativeApplicationEntryPoint on the old package.
await syncAutolinkingCache();

// Patch the build-time copy of google-services.json to include a client entry
// for the suffixed package, since Firebase only knows about the base package.
// The cloned entry reuses the base Firebase app ID — fine for local/dev builds.
if (nameSuffix) {
  const gsPath = 'android/app/google-services.json'
  const gs = JSON.parse(await readFile(gsPath, 'utf-8'))
  const newPkg = resolveAndroidPackageName()
  const baseClient = gs.client?.find(
    (c) => c.client_info?.android_client_info?.package_name === 'com.mentra.mentra',
  )
  const alreadyHas = gs.client?.some(
    (c) => c.client_info?.android_client_info?.package_name === newPkg,
  )
  if (baseClient && !alreadyHas) {
    const clone = JSON.parse(JSON.stringify(baseClient))
    clone.client_info.android_client_info.package_name = newPkg
    gs.client.push(clone)
    await writeFile(gsPath, JSON.stringify(gs, null, 2))
  }
}

// bundle js code:
await $({stdio: "inherit"})`bun expo export --platform android --clear`

// Build release APK
await $({ stdio: 'inherit', cwd: 'android' })`./gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx3072m`;

// Install APK on device. Prefer ANDROID_SERIAL; otherwise pick a phone when
// Mentra Live glasses are also attached (adb fails on "more than one device").
const apkPath = 'android/app/build/outputs/apk/release/app-release.apk'
if (isOpenAlmaBuild) {
  const metadata = JSON.parse(await readFile('android/app/build/outputs/apk/release/output-metadata.json', 'utf-8'))
  const apk = metadata.elements?.find((entry) => entry.outputFile === 'app-release.apk')
  if (metadata.applicationId !== forkPackage || !apk || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(apk.versionName) || !Number.isSafeInteger(apk.versionCode) || apk.versionCode < 1) {
    throw new Error('Invalid OpenAlma release APK identity or version metadata')
  }
  const publicationPath = `android/app/build/outputs/apk/release/OpenAlma-Mentra-${apk.versionName}-${apk.versionCode}.apk`
  await copyFile(apkPath, publicationPath)
  console.log(`Publication APK: ${publicationPath}`)
}
const serial = await resolveAdbSerial()
console.log(`Installing APK on ${serial}...`)
await $({stdio: 'inherit'})`adb -s ${serial} install -r ${apkPath}`

console.log('✅ Android release built and installed successfully!');
if (nameSuffix) {
  console.log(`   Package: com.mentra.mentra.${nameSuffix}`)
  console.log(`   App label: ${nameSuffix}`)
}

async function resolveAdbSerial() {
  if (process.env.ANDROID_SERIAL?.trim()) {
    return process.env.ANDROID_SERIAL.trim()
  }

  const {stdout} = await $`adb devices -l`
  const devices = stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('*'))
    .map((line) => {
      const parts = line.split(/\s+/)
      return {serial: parts[0], state: parts[1], raw: line}
    })
    .filter((d) => d.state === 'device')

  if (devices.length === 0) {
    throw new Error('No adb devices ready. Connect a phone and retry.')
  }
  if (devices.length === 1) {
    return devices[0].serial
  }

  const phones = devices.filter((d) => !/MentraLive|Mentra_Live/i.test(d.raw))
  if (phones.length === 1) {
    console.log(
      `Multiple adb devices; installing on phone ${phones[0].serial} (skipping Mentra Live)`,
    )
    return phones[0].serial
  }

  const list = devices.map((d) => `  ${d.raw}`).join('\n')
  throw new Error(
    `Multiple adb devices; set ANDROID_SERIAL to choose one:\n${list}`,
  )
}
