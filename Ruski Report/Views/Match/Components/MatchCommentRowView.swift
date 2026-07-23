//
//  MatchCommentRowView.swift
//  Ruski Report
//

import Foundation
import SwiftUI

struct MatchCommentRowView: View {
    let comment: MatchComment
    let report: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.crop.circle.fill")
                .font(.title3)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(comment.authorDisplayName)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)

                Text(MatchCommentTimestampFormatter.displayText(for: comment.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(comment.body)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: 4)

            Menu {
                Button {
                    report()
                } label: {
                    Label("Report Comment", systemImage: "exclamationmark.bubble")
                }
                .accessibilityIdentifier("match.comments.report.\(comment.id)")
            } label: {
                Image(systemName: "ellipsis")
                    .frame(minWidth: 32, minHeight: 32)
            }
            .accessibilityLabel("Actions for comment by \(comment.authorDisplayName)")
            .accessibilityIdentifier("match.comments.actions.\(comment.id)")
        }
    }
}

private enum MatchCommentTimestampFormatter {
    private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let standardISOFormatter = ISO8601DateFormatter()

    static func displayText(for value: String) -> String {
        let date = fractionalISOFormatter.date(from: value) ??
            standardISOFormatter.date(from: value)

        guard let date else {
            return value
        }

        return date.formatted(
            .dateTime
                .month(.abbreviated)
                .day()
                .hour()
                .minute()
        )
    }
}
