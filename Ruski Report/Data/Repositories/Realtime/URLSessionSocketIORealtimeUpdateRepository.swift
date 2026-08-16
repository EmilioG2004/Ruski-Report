//
//  URLSessionSocketIORealtimeUpdateRepository.swift
//  Ruski Report
//

import Foundation

nonisolated final class URLSessionSocketIORealtimeUpdateRepository: RealtimeUpdateRepository {
    private let webSocketURL: URL
    private let session: URLSession
    private let logger: any AppLogger
    private let reconnectDelay: UInt64

    init(
        apiBaseURL: URL,
        session: URLSession = .shared,
        logger: any AppLogger = NoopAppLogger(),
        reconnectDelay: UInt64 = 2_000_000_000
    ) {
        self.webSocketURL = Self.makeWebSocketURL(apiBaseURL: apiBaseURL)
        self.session = session
        self.logger = logger
        self.reconnectDelay = reconnectDelay
    }

    func updates(subscription: RealtimeSubscription) -> AsyncStream<RealtimeUpdate> {
        AsyncStream { continuation in
            let connection = SocketIORealtimeConnection(
                webSocketURL: webSocketURL,
                session: session,
                logger: logger,
                reconnectDelay: reconnectDelay
            )
            let task = Task {
                await connection.run(
                    subscription: subscription,
                    continuation: continuation
                )
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    static func makeWebSocketURL(apiBaseURL: URL) -> URL {
        var components = URLComponents(
            url: apiBaseURL,
            resolvingAgainstBaseURL: false
        ) ?? URLComponents()

        components.scheme = apiBaseURL.scheme == "https" ? "wss" : "ws"
        components.path = "/socket.io/"
        components.queryItems = [
            URLQueryItem(name: "EIO", value: "4"),
            URLQueryItem(name: "transport", value: "websocket")
        ]

        return components.url ?? apiBaseURL
    }
}

nonisolated private final class SocketIORealtimeConnection {
    private let webSocketURL: URL
    private let session: URLSession
    private let logger: any AppLogger
    private let reconnectDelay: UInt64
    private var socket: URLSessionWebSocketTask?

    init(
        webSocketURL: URL,
        session: URLSession,
        logger: any AppLogger,
        reconnectDelay: UInt64
    ) {
        self.webSocketURL = webSocketURL
        self.session = session
        self.logger = logger
        self.reconnectDelay = reconnectDelay
    }

    func run(
        subscription: RealtimeSubscription,
        continuation: AsyncStream<RealtimeUpdate>.Continuation
    ) async {
        defer {
            socket?.cancel(with: .goingAway, reason: nil)
            continuation.finish()
        }

        while !Task.isCancelled {
            do {
                try await connectAndRead(
                    subscription: subscription,
                    continuation: continuation
                )
            } catch is CancellationError {
                return
            } catch {
                logger.log(
                    .warning,
                    "Realtime connection failed",
                    metadata: ["error": String(describing: error)]
                )
                socket?.cancel(with: .goingAway, reason: nil)

                try? await Task.sleep(nanoseconds: reconnectDelay)
            }
        }
    }

    private func connectAndRead(
        subscription: RealtimeSubscription,
        continuation: AsyncStream<RealtimeUpdate>.Continuation
    ) async throws {
        let socket = session.webSocketTask(with: webSocketURL)
        self.socket = socket
        socket.resume()

        logger.log(
            .info,
            "Realtime socket connecting",
            metadata: ["url": webSocketURL.absoluteString]
        )

        while !Task.isCancelled {
            let frame = try SocketIOFrame.parse(try await socket.receiveString())

            switch frame {
            case .engineOpen:
                try await socket.sendString(SocketIOFrame.namespaceConnect)
            case .enginePing:
                try await socket.sendString(SocketIOFrame.pong)
            case .namespaceConnected:
                try await socket.sendString(
                    SocketIOFrame.subscribe(subscription: subscription)
                )
                logger.log(
                    .info,
                    "Realtime socket subscribed",
                    metadata: [
                        "scope": subscription.scope.rawValue,
                        "tournamentId": subscription.tournamentId ?? "",
                        "matchId": subscription.matchId ?? ""
                    ]
                )
            case .liveUpdate(let update):
                continuation.yield(update)
            case .ignored:
                continue
            }
        }
    }
}

private extension URLSessionWebSocketTask {
    func receiveString() async throws -> String {
        switch try await receive() {
        case .string(let value):
            return value
        case .data(let data):
            guard let value = String(data: data, encoding: .utf8) else {
                throw AppError.decodingFailed("Realtime frame was not UTF-8.")
            }
            return value
        @unknown default:
            throw AppError.decodingFailed("Realtime frame type is unsupported.")
        }
    }

    func sendString(_ value: String) async throws {
        try await send(.string(value))
    }
}
