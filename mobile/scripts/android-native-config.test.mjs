import {expect, test} from "bun:test"

import plugin from "../plugins/android"

test("native configuration follows the complete interpolated Gradle field", async () => {
  const field =
    '    buildConfigField "String", "REACT_NATIVE_RELEASE_LEVEL", "\\"${findProperty(\'reactNativeReleaseLevel\') ?: \'stable\'}\\""'
  const config = plugin({name: "Test", slug: "test", android: {package: "com.example.test"}})
  const result = await config.mods.android.appBuildGradle({
    ...config,
    modRequest: {platform: "android", modName: "appBuildGradle"},
    modResults: {contents: `android {\n  defaultConfig {\n${field}\n  }\n}`, language: "groovy"},
  })
  expect(result.modResults.contents).toContain(`${field}\n\n        externalNativeBuild`)
})
