//
//  MatchCommentRowView.swift
//  Ruski Report
//
//  Presents one conversation entry with accessible moderation actions and
//  timestamp formatting isolated from feed state.
//

import Foundation
import SwiftUI

struct MatchCommentRowView: View {
    let comment: MatchComment
    let report: () -> Void
    let block: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: AppLayout.compactSpacing) {
            TeamMonogramView(
                name: comment.authorDisplayName,
                size: AppLayout.commentAvatarSize
            )

            VStack(alignment: .leading, spacing: AppLayout.microSpacing) {
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
                    .padding(.top, AppLayout.microSpacing)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: AppLayout.microSpacing)

            Menu {
                Button {
                    report()
                } label: {
                    Label("Report Comment", systemImage: "exclamationmark.bubble")
                }
                .accessibilityIdentifier("match.comments.report.\(comment.id)")

                if let block {
                    Button(role: .destructive) {
                        block()
                    } label: {
                        Label(
                            "Block User",
                            systemImage: "person.crop.circle.badge.xmark"
                        )
                    }
                    .accessibilityIdentifier("match.comments.block.\(comment.id)")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .frame(
                        minWidth: AppLayout.minimumTapTarget,
                        minHeight: AppLayout.minimumTapTarget
                    )
            }
            .accessibilityLabel("Actions for comment by \(comment.authorDisplayName)")
            .accessibilityIdentifier("match.comments.actions.\(comment.id)")
        }
        .padding(AppLayout.standardSpacing)
        .background(Color.appInsetBackground)
        .clipShape(
            RoundedRectangle(
                cornerRadius: AppLayout.compactRadius,
                style: .continuous
            )
        )
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
