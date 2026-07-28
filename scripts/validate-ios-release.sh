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
readonly DERIVED_DATA_DIRECTORY="$(mktemp -d -t ruski-release-derived-data.XXXXXX)"
trap 'rm -f "${BUILD_SETTINGS_LOG}"; rm -rf "${DERIVED_DATA_DIRECTORY}"' EXIT

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
assert_build_setting "SUPPORTED_PLATFORMS" "iphoneos iphonesimulator"
assert_build_setting "SUPPORTS_MACCATALYST" "NO"
assert_build_setting "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD" "NO"
assert_build_setting "SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD" "NO"
assert_build_setting "TARGETED_DEVICE_FAMILY" "1"

echo "iOS release configuration and app icons are valid."
