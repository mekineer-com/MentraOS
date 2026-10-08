import assert from "node:assert/strict"
import {execFileSync} from "node:child_process"
import {constants, globSync, readFileSync} from "node:fs"
import {createRequire} from "node:module"
import {homedir} from "node:os"
import test from "node:test"
import {runInNewContext} from "node:vm"
import ts from "typescript"
import {VARIANT_RE, resolveAndroidPackageName} from "./android-package-name.cjs"
import {withDebugAbiFilters} from "./android-abi-filters.mjs"
import {CLOUDS} from "../../.github/scripts/prepare-mobile-release-env.mjs"
import {parsePinnedEnv} from "./local-build-number.mjs"
import {familyBuildNumberPrefix, BUILD_NUMBER_RELEASE_SEQUENCE_LIMIT, nonReleaseBuildNumber} from "../../.github/scripts/release-family.mjs"

const require = createRequire(import.meta.url)
const fork = "com.mentra.mentra.openalma"
const compile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true},
}).outputText.replace(/^#!.*\n/, "").replaceAll("import.meta.url", JSON.stringify(new URL(file, import.meta.url).href))

function generateGradle(packageName, contents) {
  const exports = {}
  runInNewContext(compile("../plugins/android.ts"), {
    exports, process,
    require: (name) => {
      if (name === "@expo/config-plugins") return {
        withAppBuildGradle: (config, callback) => callback(config),
        withProjectBuildGradle: (config) => config,
        withSettingsGradle: (config) => config,
        withGradleProperties: (config) => config,
        withAndroidManifest: (config) => config,
      }
      if (name.endsWith("android-abi-filters.mjs")) return {withDebugAbiFilters}
      return require(name)
    },
  })
  return exports.default({android: {package: packageName}, modResults: {contents}}).modResults.contents
}

const gradleFixture = `def jscFlavor = 'io.github.react-native-community:jsc-android:2026004.+'
android {
  signingConfigs { debug { storeFile file('debug.keystore') } }
  buildTypes { release { signingConfig signingConfigs.debug } }
}
`
test("signing guard refreshes existing Gradle and changes with host identity", () => {
  const stock = generateGradle("com.mentra.mentra", gradleFixture)
  const generated = generateGradle(fork, stock)
  assert.match(generated, /if \(true && graph.allTasks/)
  assert.match(generated, /storeFile releaseKeystoreFile/)
  assert.match(generated, /signingConfig signingConfigs.release/)
  assert.equal(generateGradle(fork, generated), generated)
  assert.match(generateGradle("com.mentra.mentra", generated), /if \(false && graph.allTasks/)
})

const groovyJar = globSync(`${homedir()}/.gradle/wrapper/dists/*/*/*/lib/groovy-[0-9]*.jar`)[0]
test("Groovy rejects unsigned fork release tasks, not Stock or debug tasks", {skip: !groovyJar}, () => {
  const guard = (pkg) => generateGradle(pkg, gradleFixture).split("// OpenAlma release signing guard")[1]
  const exercise = (pkg, task, keystore, storePassword, keyPassword) => `
def project = new Object()
def releaseKeystoreFile = ${keystore ? "new File('test-only.jks')" : "null"}
def releaseStorePassword = '${storePassword}'
def releaseKeyPassword = '${keyPassword}'
class GradleException extends RuntimeException { GradleException(String message) { super(message) } }
def gradle = [taskGraph: [whenReady: { callback -> callback([allTasks: [[project: project, name: '${task}']]]) }]]
${guard(pkg)}
`
  // Run all cases in one small JVM, without Gradle or any keystore access.
  const cases = [
    [fork, "assembleRelease", false, "store", "key", true],
    [fork, "bundleRelease", true, "", "key", true],
    [fork, "assembleRelease", true, "store", " ", true],
    [fork, "assembleRelease", true, "store", "key", false],
    [fork, "assembleDebug", false, "", "", false],
    ["com.mentra.mentra", "assembleRelease", false, "", "", false],
  ]
  const script = cases.map(([pkg, task, key, storePass, keyPass, fails]) => {
    const source = JSON.stringify(exercise(pkg, task, key, storePass, keyPass))
    return `try { new GroovyShell().evaluate(${source}); assert ${!fails} } catch (RuntimeException e) { assert ${fails}; assert e.message.contains('OpenAlma release requires') }`
  }).join("\n")
  execFileSync("java", ["-Xmx128m", "-cp", groovyJar, "groovy.ui.GroovyMain", "-e", script], {timeout: 30000})
})

async function runRelease({name, env = {}, loadedEnv = {}, generatedPackage = fork, metadata = {}, fileOverrides = {}, backupError, committerTime = Date.parse("2026-10-09T12:39Z") / 1000} = {}) {
  const environment = {ANDROID_SERIAL: "test-phone", MENTRAOS_PINNED_BUILD_NUMBER: "302010123", ...env}
  const commands = [], copies = [], writes = [], backups = [], events = []
  const buildNumberHelper = {}
  runInNewContext(compile("./build-number.mjs"), {
    exports: buildNumberHelper, process: {env: environment},
    require: (name) => {
      if (name === "node:child_process") return {execFileSync: () => String(committerTime)}
      if (name === "node:fs") return {readFileSync: () => '{"version":"3.2.1"}'}
      if (name === "../../.github/scripts/release-family.mjs") return {nonReleaseBuildNumber}
      return require(name)
    },
  })
  let nativeBuildNumber
  const files = {
    "../package.json": '{"version":"3.2.1"}',
    ".env": "EXPO_PUBLIC_MENTRAOS_VERSION=3.1.0\nEXPO_PUBLIC_BUILD_ENV=dev\nEXPO_PUBLIC_CLOUD_CORE_URL=https://core.dev.example.invalid\nEXPO_PUBLIC_CLOUD_RUNTIME_URL=https://runtime.dev.example.invalid\nOTHER=test\n",
    "android/app/build.gradle": `android { defaultConfig { applicationId "${generatedPackage}" } }`,
    "android/app/google-services.json": JSON.stringify({client: [{
      client_info: {mobilesdk_app_id: "test-firebase-app", android_client_info: {package_name: "com.mentra.mentra"}},
    }]}),
    ...fileOverrides,
  }
  const command = async (strings, ...values) => {
    const command = String.raw({raw: strings}, ...values)
    commands.push(command)
    if (command.includes("expo prebuild")) nativeBuildNumber = buildNumberHelper.getBuildNumber()
    if (command.includes("assembleRelease")) {
      assert.equal(buildNumberHelper.getBuildNumber(), nativeBuildNumber)
      files["android/app/build/outputs/apk/release/output-metadata.json"] = JSON.stringify({
        applicationId: generatedPackage,
        elements: [{outputFile: "app-release.apk", versionName: "3.2.1", versionCode: nativeBuildNumber}],
        ...metadata,
      })
    }
    return {stdout: ""}
  }
  const dollar = (...args) => Array.isArray(args[0]) ? command(...args) : command
  const promise = runInNewContext(`(async () => { ${compile("./android-release.mjs")} })()`, {
    exports: {}, process: {env: environment}, argv: name === undefined ? {} : {name}, $: dollar,
    console: {log: () => {}},
    require: (name) => {
      if (name === "zx/globals") return {}
      if (name === "fs") return {constants}
      if (name === "fs/promises") return {
        readFile: async (path) => {
          assert.ok(path in files, `unexpected read: ${path}`)
          return files[path]
        },
        writeFile: async (path, contents) => { writes.push(path); files[path] = contents },
        copyFile: async (source, destination, mode) => {
          if (source !== ".env") { copies.push([source, destination]); return }
          assert.equal(mode, constants.COPYFILE_EXCL)
          if (backupError) throw Object.assign(new Error("backup failed"), {code: backupError})
          if (files[source] === undefined) throw Object.assign(new Error("no source"), {code: "ENOENT"})
          if (destination in files) throw Object.assign(new Error("exists"), {code: "EEXIST"})
          files[destination] = files[source]
          backups.push(destination)
          events.push("backup")
        },
      }
      if (name === "./set-build-env.mjs") return {setBuildEnv: async () => {
        events.push("setBuildEnv")
        files[".env"] = (files[".env"] ?? "") + "# setBuildEnv ran\n"
        Object.assign(environment, loadedEnv)
      }}
      if (name === "./clear-autolinking-cache.mjs") return {syncAutolinkingCache: async () => {}}
      if (name === "./android-package-name.cjs") return {
        VARIANT_RE,
        resolveAndroidPackageName: () => resolveAndroidPackageName({
          region: environment.EXPO_PUBLIC_DEPLOYMENT_REGION, buildName: environment.MENTRAOS_BUILD_NAME,
        }),
      }
      if (name === "../../.github/scripts/prepare-mobile-release-env.mjs") return {CLOUDS}
      if (name === "./local-build-number.mjs") return {parsePinnedEnv}
      if (name === "../../.github/scripts/release-family.mjs") return {familyBuildNumberPrefix, BUILD_NUMBER_RELEASE_SEQUENCE_LIMIT}
      throw new Error(`unexpected module: ${name}`)
    },
  })
  await promise
  return {environment, commands, copies, writes, files, backups, events, nativeBuildNumber}
}

test("backs up original env before mutation, numbers collisions and refuses backup failures", async () => {
  for (const fileOverrides of [{}, {".env.orig": "older", ".env2.orig": "also older"}]) {
    const result = await runRelease({name: "openalma", fileOverrides})
    const destination = Object.keys(fileOverrides).length ? ".env3.orig" : ".env.orig"
    assert.deepEqual(result.backups, [destination])
    assert.deepEqual(result.events, ["backup", "setBuildEnv"])
    assert.match(result.files[destination], /EXPO_PUBLIC_MENTRAOS_VERSION=3.1.0/)
    assert.ok(!result.files[destination].includes("# setBuildEnv ran"))
    for (const [path, contents] of Object.entries(fileOverrides)) assert.equal(result.files[path], contents)
  }
  await assert.rejects(runRelease({name: "openalma", backupError: "EACCES"}), /backup failed/)
  const fresh = await runRelease({name: "openalma", fileOverrides: {".env": undefined}})
  assert.deepEqual(fresh.backups, [])
  assert.deepEqual(fresh.events, ["setBuildEnv"])
})

test("fork CLI and dotenv builds synchronize JS version and copy actual Gradle APK identity", async () => {
  for (const options of [{name: "openalma"}, {loadedEnv: {MENTRAOS_BUILD_NAME: "openalma"}}]) {
    const result = await runRelease(options)
    assert.equal(result.environment.EXPO_PUBLIC_MENTRAOS_VERSION, "3.2.1")
    assert.equal(result.environment.EXPO_PUBLIC_BUILD_ENV, "prod")
    assert.equal(result.environment.EXPO_PUBLIC_CLOUD_CORE_URL, CLOUDS.prod.core)
    assert.equal(result.environment.EXPO_PUBLIC_CLOUD_RUNTIME_URL, CLOUDS.prod.runtime)
    assert.match(result.files[".env"], /EXPO_PUBLIC_MENTRAOS_VERSION=3.2.1\n/)
    assert.match(result.files[".env"], /EXPO_PUBLIC_BUILD_ENV=prod\n/)
    assert.ok(!result.files[".env"].includes("https://core.dev.example.invalid"))
    assert.match(result.files[".env"], /OTHER=test/)
    assert.equal(result.nativeBuildNumber, 302010123)
    const clients = JSON.parse(result.files["android/app/google-services.json"]).client
    assert.deepEqual(clients.map((client) => client.client_info.android_client_info.package_name), ["com.mentra.mentra", fork])
    assert.equal(clients[1].client_info.mobilesdk_app_id, clients[0].client_info.mobilesdk_app_id)
    assert.deepEqual(result.copies, [[
      "android/app/build/outputs/apk/release/app-release.apk",
      "android/app/build/outputs/apk/release/OpenAlma-Mentra-3.2.1-302010123.apk",
    ]])
  }
})

test("coordinated beta/dev full JS identities and Stock/local variants are unchanged", async () => {
  for (const env of [
    {MENTRA_COORDINATED_RELEASE_CHANNEL: "beta", EXPO_PUBLIC_MENTRAOS_VERSION: "3.2.1-beta.57", EXPO_PUBLIC_BUILD_ENV: "staging", EXPO_PUBLIC_CLOUD_CORE_URL: CLOUDS.staging.core},
    {MENTRAOS_NATIVE_MARKETING_VERSION: "3.2.1", EXPO_PUBLIC_MENTRAOS_VERSION: "3.2.1-dev.42", EXPO_PUBLIC_BUILD_ENV: "dev", EXPO_PUBLIC_CLOUD_CORE_URL: CLOUDS.dev.core},
  ]) {
    const result = await runRelease({name: "openalma", env})
    assert.equal(result.environment.EXPO_PUBLIC_MENTRAOS_VERSION, env.EXPO_PUBLIC_MENTRAOS_VERSION)
    assert.equal(result.environment.EXPO_PUBLIC_BUILD_ENV, env.EXPO_PUBLIC_BUILD_ENV)
    assert.equal(result.environment.EXPO_PUBLIC_CLOUD_CORE_URL, env.EXPO_PUBLIC_CLOUD_CORE_URL)
    assert.ok(!result.writes.includes(".env"))
  }
  for (const name of [undefined, "stable"]) {
    const result = await runRelease({name, env: {EXPO_PUBLIC_MENTRAOS_VERSION: "3.2.0", MENTRAOS_PINNED_BUILD_NUMBER: undefined}})
    assert.equal(result.environment.EXPO_PUBLIC_MENTRAOS_VERSION, "3.2.0")
    assert.equal(result.copies.length, 0)
    const packages = JSON.parse(result.files["android/app/google-services.json"]).client.map((client) => client.client_info.android_client_info.package_name)
    assert.deepEqual(packages, name ? ["com.mentra.mentra", `com.mentra.mentra.${name}`] : ["com.mentra.mentra"])
  }
})

test("fork publication requires a release-family pin and exports that helper-derived number", async () => {
  for (const selection of [{name: "openalma"}, {loadedEnv: {MENTRAOS_BUILD_NAME: "openalma"}}]) {
    for (const pin of [undefined, "", "0", "-1", "302010123junk", "1.5", "9007199254740992", "302000123", "302010000", "302013000", "302019999"]) {
      await assert.rejects(runRelease({...selection, env: {MENTRAOS_PINNED_BUILD_NUMBER: pin}}), /explicitly allocated MENTRAOS_PINNED_BUILD_NUMBER/)
    }
    for (const pin of ["302010001", " 302012999 "]) {
      const result = await runRelease({...selection, env: {MENTRAOS_PINNED_BUILD_NUMBER: pin}})
      assert.equal(result.nativeBuildNumber, Number(pin))
      assert.equal(result.environment.MENTRAOS_PINNED_BUILD_NUMBER, String(Number(pin)))
      assert.ok(result.copies[0][1].endsWith(`-${Number(pin)}.apk`))
    }
  }
  const dotenvPin = await runRelease({loadedEnv: {MENTRAOS_BUILD_NAME: "openalma", MENTRAOS_PINNED_BUILD_NUMBER: "302010124"}})
  assert.equal(dotenvPin.nativeBuildNumber, 302010124)
  for (const markers of [{MENTRA_COORDINATED_RELEASE_CHANNEL: "beta"}, {MENTRAOS_NATIVE_MARKETING_VERSION: "3.2.1"}]) {
    await assert.rejects(runRelease({name: "openalma", env: {...markers, MENTRAOS_PINNED_BUILD_NUMBER: undefined}}), /explicitly allocated/)
  }
  await assert.rejects(runRelease({name: "openalma", metadata: {
    elements: [{outputFile: "app-release.apk", versionName: "3.2.1", versionCode: 302010124}],
  }}), /does not match MENTRAOS_PINNED_BUILD_NUMBER/)
})

test("development fallback still wraps but fork publication cannot use it", async () => {
  for (const [clock, number] of [["2026-10-09T12:39Z", 302019999], ["2026-10-09T12:40Z", 302013000]]) {
    const committerTime = Date.parse(clock) / 1000
    const development = await runRelease({generatedPackage: "com.mentra.mentra", committerTime, env: {
      MENTRAOS_PINNED_BUILD_NUMBER: undefined,
      MENTRAOS_NATIVE_MARKETING_VERSION: "3.2.1", EXPO_PUBLIC_MENTRAOS_VERSION: "3.2.1-dev.42",
    }})
    assert.equal(development.nativeBuildNumber, number)
    await assert.rejects(runRelease({name: "openalma", committerTime, env: {MENTRAOS_PINNED_BUILD_NUMBER: undefined}}), /explicitly allocated/)
    const release = await runRelease({name: "openalma", committerTime})
    assert.equal(release.nativeBuildNumber, 302010123)
  }
})

test("fork release refuses invalid variants, generated China and Stock identity", async () => {
  await assert.rejects(runRelease({name: "openalma!"}), /Invalid --name/)
  await assert.rejects(runRelease({name: ""}), /Invalid --name/)
  await assert.rejects(runRelease({name: "openalma", env: {EXPO_PUBLIC_DEPLOYMENT_REGION: "china"}, generatedPackage: "com.mentra.mentra.cn.openalma"}), /must use/)
  await assert.rejects(runRelease({name: "openalma", generatedPackage: "com.mentra.mentra"}), /must use/)
  await assert.rejects(runRelease({name: "openalma", metadata: {applicationId: "com.mentra.mentra"}}), /Invalid OpenAlma/)
  await assert.rejects(runRelease({name: "openalma", metadata: {elements: []}}), /Invalid OpenAlma/)
  await assert.rejects(runRelease({name: "openalma", metadata: {
    elements: [{outputFile: "app-release.apk", versionName: "../bad", versionCode: 1}],
  }}), /Invalid OpenAlma/)
})
