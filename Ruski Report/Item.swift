//
//  Item.swift
//  Ruski Report
//
//  Created by Emilio Lukas Garci on 5/15/26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
