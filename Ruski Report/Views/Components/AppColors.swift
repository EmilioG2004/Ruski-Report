//
//  AppColors.swift
//  Ruski Report
//

import SwiftUI

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

extension Color {
    static var appBrand: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(red: 0.45, green: 0.65, blue: 1.00, alpha: 1)
                    : UIColor(red: 0.05, green: 0.18, blue: 0.42, alpha: 1)
            }
        )
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.systemBlue)
        #else
        Color.blue
        #endif
    }

    static var appBrandSecondary: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(red: 0.54, green: 0.30, blue: 0.35, alpha: 1)
                    : UIColor(red: 0.73, green: 0.05, blue: 0.12, alpha: 1)
            }
        )
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.systemRed)
        #else
        Color.red
        #endif
    }

    static var appGroupedBackground: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(red: 0.025, green: 0.04, blue: 0.08, alpha: 1)
                    : UIColor(red: 0.955, green: 0.965, blue: 0.985, alpha: 1)
            }
        )
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.windowBackgroundColor)
        #else
        Color.clear
        #endif
    }

    static var appSecondaryGroupedBackground: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(red: 0.075, green: 0.095, blue: 0.14, alpha: 1)
                    : UIColor.white
            }
        )
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.controlBackgroundColor)
        #else
        Color.clear
        #endif
    }

    static var appInsetBackground: Color {
        #if canImport(UIKit)
        Color(
            uiColor: UIColor { traits in
                traits.userInterfaceStyle == .dark
                    ? UIColor(red: 0.105, green: 0.125, blue: 0.18, alpha: 1)
                    : UIColor(red: 0.91, green: 0.93, blue: 0.965, alpha: 1)
            }
        )
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.unemphasizedSelectedContentBackgroundColor)
        #else
        Color.gray.opacity(0.12)
        #endif
    }

    static var appSeparator: Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor.separator)
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.separatorColor)
        #else
        Color.gray.opacity(0.25)
        #endif
    }

    static var appLive: Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor.systemRed)
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.systemRed)
        #else
        Color.red
        #endif
    }

    static var appFinal: Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor.systemGreen)
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.systemGreen)
        #else
        Color.green
        #endif
    }

    static var appOnBrand: Color {
        Color.white
    }

    static var appBrandGradient: LinearGradient {
        LinearGradient(
            colors: [
                appBrand,
                appBrand.opacity(AppVisualTokens.gradientMiddleOpacity),
                appBrandSecondary.opacity(AppVisualTokens.gradientEndOpacity)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
