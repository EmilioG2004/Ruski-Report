#!/usr/bin/env bash

set -euo pipefail

readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROJECT_PATH="${REPOSITORY_ROOT}/Ruski Report.xcodeproj"
readonly APP_ICON_DIRECTORY="${REPOSITORY_ROOT}/Ruski Report/Assets.xcassets/AppIcon.appiconset"
readonly APP_ICON_CONTENTS="${APP_ICON_DIRECTORY}/Contents.json"

fail() {
  echo "iOS release validation failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local description="$3"

  [[ "${haystack}" == *"${needle}"* ]] ||
    fail "${description}; expected '${needle}'"
}

require_command jq
require_command plutil
require_command rg
require_command sips
require_command xcodebuild

jq -e '
  (.images | length == 3)
  and ([.images[].filename] | sort == [
    "AppIcon-Dark.png",
    "AppIcon-Default.png",
    "AppIcon-Tinted.png"
  ])
  and ([.images[].idiom] | unique == ["universal"])
  and ([.images[].platform] | unique == ["ios"])
  and ([.images[].size] | unique == ["1024x1024"])
  and (
    [.images[] | select(.filename == "AppIcon-Dark.png")
      | .appearances[0].value] == ["dark"]
  )
  and (
    [.images[] | select(.filename == "AppIcon-Tinted.png")
      | .appearances[0].value] == ["tinted"]
  )
' "${APP_ICON_CONTENTS}" >/dev/null ||
  fail "AppIcon Contents.json does not define the required iOS variants"

validate_icon() {
  local filename="$1"
  local expected_space="$2"
  local path="${APP_ICON_DIRECTORY}/${filename}"
  local metadata

  [[ -f "${path}" ]] || fail "missing ${filename}"
  metadata="$(sips \
    -g pixelWidth \
    -g pixelHeight \
    -g format \
    -g space \
    -g hasAlpha \
    "${path}")"

  assert_contains "${metadata}" "pixelWidth: 1024" "${filename} has the wrong width"
  assert_contains "${metadata}" "pixelHeight: 1024" "${filename} has the wrong height"
  assert_contains "${metadata}" "format: png" "${filename} is not a PNG"
  assert_contains "${metadata}" "space: ${expected_space}" "${filename} has the wrong color space"
  assert_contains "${metadata}" "hasAlpha: no" "${filename} must be opaque"
}

validate_icon "AppIcon-Default.png" "RGB"
validate_icon "AppIcon-Dark.png" "RGB"
validate_icon "AppIcon-Tinted.png" "Gray"

readonly BUILD_SETTINGS_LOG="$(mktemp -t ruski-release-settings.XXXXXX)"
readonly ARCHIVE_LOG="$(mktemp -t ruski-release-archive.XXXXXX)"
readonly DERIVED_DATA_DIRECTORY="$(mktemp -d -t ruski-release-derived-data.XXXXXX)"
readonly ARCHIVE_PATH="${DERIVED_DATA_DIRECTORY}/RuskiReport.xcarchive"
trap 'rm -f "${BUILD_SETTINGS_LOG}" "${ARCHIVE_LOG}"; rm -rf "${DERIVED_DATA_DIRECTORY}"' EXIT

if ! xcodebuild \
  -project "${PROJECT_PATH}" \
  -scheme "Ruski Report" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "${DERIVED_DATA_DIRECTORY}" \
  -showBuildSettings >"${BUILD_SETTINGS_LOG}" 2>&1; then
  cat "${BUILD_SETTINGS_LOG}" >&2
  fail "Xcode could not resolve Release build settings"
fi

build_setting() {
  local key="$1"

  awk -v key="${key}" '
    $1 == key && $2 == "=" {
      $1 = ""
      $2 = ""
      sub(/^[[:space:]]+/, "")
      print
      exit
    }
  ' "${BUILD_SETTINGS_LOG}"
}

assert_build_setting() {
  local key="$1"
  local expected="$2"
  local actual

  actual="$(build_setting "${key}")"
  [[ "${actual}" == "${expected}" ]] ||
    fail "${key} expected '${expected}', got '${actual:-<unset>}'"
}

assert_build_setting "CODE_SIGN_STYLE" "Automatic"
assert_build_setting "CURRENT_PROJECT_VERSION" "1"
assert_build_setting "DEVELOPMENT_TEAM" "F4784JNT6Y"
assert_build_setting "INFOPLIST_KEY_CFBundleDisplayName" "Ruski Report"
assert_build_setting "INFOPLIST_KEY_UILaunchScreen_Generation" "YES"
assert_build_setting \
  "INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone" \
  "UIInterfaceOrientationPortrait"
assert_build_setting "IPHONEOS_DEPLOYMENT_TARGET" "17.0"
assert_build_setting "MARKETING_VERSION" "1.0"
assert_build_setting "PRODUCT_BUNDLE_IDENTIFIER" "com.emiliogarcia.ruskireport"
assert_build_setting "RUSKI_API_BASE_URL" "https://api.ruskireport.com/api"
assert_build_setting "RUSKI_BUILD_CONFIGURATION" "Release"
assert_build_setting "SUPPORTED_PLATFORMS" "iphoneos iphonesimulator"
assert_build_setting "SUPPORTS_MACCATALYST" "NO"
assert_build_setting "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD" "NO"
assert_build_setting "SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD" "NO"
assert_build_setting "TARGETED_DEVICE_FAMILY" "1"

if ! xcodebuild \
  -project "${PROJECT_PATH}" \
  -scheme "Ruski Report" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -derivedDataPath "${DERIVED_DATA_DIRECTORY}" \
  -archivePath "${ARCHIVE_PATH}" \
  CODE_SIGNING_ALLOWED=NO \
  archive >"${ARCHIVE_LOG}" 2>&1; then
  cat "${ARCHIVE_LOG}" >&2
  fail "Xcode could not create the unsigned Release archive"
fi

readonly APP_PATH="${ARCHIVE_PATH}/Products/Applications/Ruski Report.app"
readonly INFO_PLIST_PATH="${APP_PATH}/Info.plist"

[[ -d "${APP_PATH}" ]] || fail "Release archive does not contain the app"

plist_value() {
  plutil -extract "$1" raw -o - "${INFO_PLIST_PATH}"
}

assert_plist_value() {
  local key="$1"
  local expected="$2"
  local actual

  actual="$(plist_value "${key}")"
  [[ "${actual}" == "${expected}" ]] ||
    fail "archived ${key} expected '${expected}', got '${actual}'"
}

assert_plist_value "CFBundleDisplayName" "Ruski Report"
assert_plist_value "CFBundleIdentifier" "com.emiliogarcia.ruskireport"
assert_plist_value "CFBundleShortVersionString" "1.0"
assert_plist_value "CFBundleVersion" "1"
assert_plist_value "RUSKI_API_BASE_URL" "https://api.ruskireport.com/api"
assert_plist_value "RUSKI_BUILD_CONFIGURATION" "Release"
assert_plist_value "UIDeviceFamily.0" "1"
assert_plist_value \
  "UISupportedInterfaceOrientations~iphone.0" \
  "UIInterfaceOrientationPortrait"

plutil -extract UILaunchScreen xml1 -o - \
  "${INFO_PLIST_PATH}" >/dev/null 2>&1 ||
  fail "Release archive is missing launch-screen metadata"

if plutil -extract NSAppTransportSecurity xml1 -o - \
  "${INFO_PLIST_PATH}" >/dev/null 2>&1; then
  fail "Release archive contains an App Transport Security exception"
fi

if rg -a -l \
  'http://(localhost|127\.0\.0\.1)|ws://(localhost|127\.0\.0\.1)' \
  "${APP_PATH}" >/dev/null; then
  fail "Release archive contains a loopback service endpoint"
fi

if rg -a -l \
  'AKIA[A-Z0-9]{16}|AWS_SECRET_ACCESS_KEY|TUNNEL_TOKEN|ADMIN_PASSWORD|POSTGRES_PASSWORD' \
  "${APP_PATH}" >/dev/null; then
  fail "Release archive contains a server credential marker"
fi

echo "iOS Release settings, app icons, and archived networking are valid."
