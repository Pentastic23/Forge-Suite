# Forge Suite for Android (test builds)

`forge-suite-test.keystore` signs the test APK so each new build installs over
the last one and keeps the app's projects. It is a test key with a public
password (`forgetest`, alias `forge`), so it only proves a build came from this
repo's workflow, not from you. To use a private key instead, add it as the repo
secrets `ANDROID_KEYSTORE_BASE64` (the keystore file in base64) and
`ANDROID_KEYSTORE_PASSWORD` (alias `forge`); the workflow uses them when they
are set. Changing the key means uninstalling the old app once before installing
the new build.
