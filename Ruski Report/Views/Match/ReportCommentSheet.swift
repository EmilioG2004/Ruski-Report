//
//  ReportCommentSheet.swift
//  Ruski Report
//

import SwiftUI

struct ReportCommentSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var controller: CommentReportingController

    let comment: CommentReportPresentation
    let configuration: CommentReportingConfiguration
    let refreshComments: () async -> Void

    @State private var reason: CommentReportReason = .harassment
    @State private var context = ""

    init(
        comment: CommentReportPresentation,
        controller: CommentReportingController,
        configuration: CommentReportingConfiguration = .default,
        refreshComments: @escaping () async -> Void
    ) {
        self.comment = comment
        self.controller = controller
        self.configuration = configuration
        self.refreshComments = refreshComments
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Comment by \(comment.authorDisplayName)")
                        .foregroundStyle(.secondary)
                }

                Section {
                    Picker("Reason", selection: $reason) {
                        ForEach(CommentReportReason.allCases) { reason in
                            Text(reason.title).tag(reason)
                        }
                    }
                    .accessibilityIdentifier("comment.report.reason")
                } header: {
                    Text("Why are you reporting this comment?")
                }

                Section {
                    TextEditor(text: $context)
                        .frame(minHeight: 100)
                        .accessibilityIdentifier("comment.report.context")

                    HStack {
                        Text(reason == .other ? "Required for Other" : "Optional")
                        Spacer()
                        Text("\(context.count)/\(configuration.maximumContextLength)")
                    }
                    .font(.caption)
                    .foregroundStyle(
                        context.count > configuration.maximumContextLength
                            ? .red
                            : .secondary
                    )
                } header: {
                    Text("Additional context")
                }

                if let errorMessage = controller.state.errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                            .accessibilityIdentifier("comment.report.error")
                    }
                }
            }
            .navigationTitle("Report Comment")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(controller.state.isSubmitting)
            .accessibilityIdentifier("comment.report.sheet")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(controller.state.isSubmitting)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(controller.state.isSubmitting ? "Sending…" : "Submit") {
                        submit()
                    }
                    .disabled(!canSubmit)
                    .accessibilityIdentifier("comment.report.submit")
                }
            }
        }
    }

    private var canSubmit: Bool {
        !controller.state.isSubmitting &&
            context.count <= configuration.maximumContextLength &&
            (reason != .other || !context.trimmingCharacters(
                in: .whitespacesAndNewlines
            ).isEmpty)
    }

    private func submit() {
        Task {
            let outcome = await controller.submit(
                commentId: comment.commentId,
                reason: reason,
                context: context
            )
            switch outcome {
            case .submitted:
                dismiss()
            case .commentUnavailable:
                await refreshComments()
                dismiss()
            case .failed:
                break
            }
        }
    }
}
