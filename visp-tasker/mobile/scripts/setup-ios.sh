#!/bin/bash
#
# VISP/Tasker - iOS Project Setup
#
# This script generates the Xcode project by using react-native init to create
# a temporary project, then copies the generated .xcodeproj and native build
# files into the existing ios/ directory. Our custom AppDelegate, Info.plist,
# LaunchScreen, and other native files are preserved.
#
# Usage:
#   cd mobile/
#   bash scripts/setup-ios.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IOS_DIR="$PROJECT_DIR/ios"
TEMP_DIR="$PROJECT_DIR/.temp-rn-init"
APP_NAME="VISPTasker"

echo "==========================================="
echo " VISP/Tasker iOS Project Setup"
echo "==========================================="
echo ""

# ── Prerequisites ───────────────────────────────

echo "[1/7] Checking prerequisites..."

command -v node >/dev/null 2>&1 || {
  echo "ERROR: Node.js is required. Install via: brew install node"
  exit 1
}

command -v npx >/dev/null 2>&1 || {
  echo "ERROR: npx is required. It should come with Node.js."
  exit 1
}

command -v pod >/dev/null 2>&1 || {
  echo "ERROR: CocoaPods is required. Install via: sudo gem install cocoapods"
  exit 1
}

NODE_VERSION=$(node -v)
echo "  Node.js: $NODE_VERSION"
echo "  CocoaPods: $(pod --version)"
echo ""

# ── Install JS dependencies ────────────────────

echo "[2/7] Installing JavaScript dependencies..."
cd "$PROJECT_DIR"
npm install
echo ""

# ── Clean up any previous temp directory ────────

echo "[3/7] Preparing temporary project..."
rm -rf "$TEMP_DIR"

# ── Generate temporary React Native project ─────

echo "[4/7] Generating Xcode project via react-native init..."
cd "$PROJECT_DIR"
npx @react-native-community/cli init "$APP_NAME" \
  --directory "$TEMP_DIR" \
  --version 0.76.6 \
  --skip-install \
  --skip-git-init

echo ""

# ── Copy generated Xcode project files ──────────

echo "[5/7] Copying Xcode project files..."

# Copy the .xcodeproj directory (contains project.pbxproj)
if [ -d "$TEMP_DIR/ios/$APP_NAME.xcodeproj" ]; then
  cp -r "$TEMP_DIR/ios/$APP_NAME.xcodeproj" "$IOS_DIR/"
  echo "  Copied: $APP_NAME.xcodeproj"
else
  echo "ERROR: Generated .xcodeproj not found!"
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Copy .xcworkspace if it exists (created by pod install)
if [ -d "$TEMP_DIR/ios/$APP_NAME.xcworkspace" ]; then
  cp -r "$TEMP_DIR/ios/$APP_NAME.xcworkspace" "$IOS_DIR/"
  echo "  Copied: $APP_NAME.xcworkspace"
fi

# Copy any generated native files we do not already have
# Our custom AppDelegate.mm, Info.plist, and LaunchScreen.storyboard take priority
TEMP_IOS_APP="$TEMP_DIR/ios/$APP_NAME"

# Copy files we might be missing from the template
for FILE in "AppDelegate.swift" "SceneDelegate.swift"; do
  if [ -f "$TEMP_IOS_APP/$FILE" ] && [ ! -f "$IOS_DIR/$APP_NAME/$FILE" ]; then
    cp "$TEMP_IOS_APP/$FILE" "$IOS_DIR/$APP_NAME/"
    echo "  Copied missing template file: $FILE"
  fi
done

# Copy the Tests directory
if [ -d "$TEMP_DIR/ios/${APP_NAME}Tests" ]; then
  cp -r "$TEMP_DIR/ios/${APP_NAME}Tests/"* "$IOS_DIR/${APP_NAME}Tests/" 2>/dev/null || true
  echo "  Copied: ${APP_NAME}Tests/"
fi

# Copy the .xcode.env file if present
if [ -f "$TEMP_DIR/ios/.xcode.env" ]; then
  cp "$TEMP_DIR/ios/.xcode.env" "$IOS_DIR/"
  echo "  Copied: .xcode.env"
fi

echo ""

# ── Update project.pbxproj bundle identifier ────

echo "[6/7] Configuring bundle identifier..."
PBXPROJ="$IOS_DIR/$APP_NAME.xcodeproj/project.pbxproj"
if [ -f "$PBXPROJ" ]; then
  # Replace the generated bundle identifier with com.visp.tasker
  sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = "org\.reactjs\.native\.example\.\$(PRODUCT_NAME:rfc1034identifier)"/PRODUCT_BUNDLE_IDENTIFIER = "com.visp.tasker"/g' "$PBXPROJ"
  sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = "org\.reactjs\.native\.example\.VISPTasker"/PRODUCT_BUNDLE_IDENTIFIER = "com.visp.tasker"/g' "$PBXPROJ"

  # Set deployment target to 15.1
  sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = [0-9]*\.[0-9]*/IPHONEOS_DEPLOYMENT_TARGET = 15.1/g' "$PBXPROJ"

  # Set portrait-only orientation
  sed -i '' 's/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = .*;/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = UIInterfaceOrientationPortrait;/g' "$PBXPROJ"
  sed -i '' 's/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = .*;/INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = UIInterfaceOrientationPortrait;/g' "$PBXPROJ"

  echo "  Bundle ID: com.visp.tasker"
  echo "  Deployment target: iOS 15.1"
  echo "  Orientation: Portrait only"
fi

echo ""

# ── Clean up ────────────────────────────────────

echo "[7/7] Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
echo ""

# ── Install CocoaPods ───────────────────────────

echo "Installing CocoaPods dependencies..."
cd "$IOS_DIR"
pod install
echo ""

echo "==========================================="
echo " Setup Complete!"
echo "==========================================="
echo ""
echo "To run the app on iOS Simulator:"
echo "  cd $(basename "$PROJECT_DIR")"
echo "  npx react-native run-ios"
echo ""
echo "Or with a specific simulator:"
echo "  npx react-native run-ios --simulator=\"iPhone 16 Pro\""
echo ""
echo "To open in Xcode:"
echo "  open ios/$APP_NAME.xcworkspace"
echo ""
