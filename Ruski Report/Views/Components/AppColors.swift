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
    static var appGroupedBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor.systemGroupedBackground)
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.windowBackgroundColor)
        #else
        Color.clear
        #endif
    }

    static var appSecondaryGroupedBackground: Color {
        #if canImport(UIKit)
        Color(uiColor: UIColor.secondarySystemGroupedBackground)
        #elseif canImport(AppKit)
        Color(nsColor: NSColor.controlBackgroundColor)
        #else
        Color.clear
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
}
