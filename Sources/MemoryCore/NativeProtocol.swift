import Foundation

public enum NativeProtocolError: Error, LocalizedError {
    case invalidFrame
    case invalidRequest
    case responseTooLarge

    public var errorDescription: String? {
        switch self {
        case .invalidFrame: "連携メッセージの長さが正しくありません。"
        case .invalidRequest: "対応していない連携リクエストです。"
        case .responseTooLarge: "連携メッセージが大きすぎます。"
        }
    }
}

public enum NativeMessageFraming {
    public static let maximumInputBytes = 65_536
    public static let maximumOutputBytes = 1_048_576

    public static func decodeLength(_ header: Data) throws -> Int {
        guard header.count == 4 else { throw NativeProtocolError.invalidFrame }
        let length = header.enumerated().reduce(UInt32(0)) { partial, entry in
            partial | (UInt32(entry.element) << UInt32(entry.offset * 8))
        }
        guard length > 0, length <= maximumInputBytes else { throw NativeProtocolError.invalidFrame }
        return Int(length)
    }

    public static func encode(_ payload: Data) throws -> Data {
        guard !payload.isEmpty else { throw NativeProtocolError.invalidFrame }
        guard payload.count <= maximumOutputBytes else { throw NativeProtocolError.responseTooLarge }
        let length = UInt32(payload.count)
        let header = Data((0..<4).map { UInt8(truncatingIfNeeded: length >> ($0 * 8)) })
        return header + payload
    }
}

public struct NativeRequest: Decodable, Equatable, Sendable {
    public let version: Int
    public let action: String

    public static func decode(_ data: Data) throws -> NativeRequest {
        guard !data.isEmpty, data.count <= NativeMessageFraming.maximumInputBytes else {
            throw NativeProtocolError.invalidRequest
        }
        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  Set(object.keys) == ["version", "action"] else { throw NativeProtocolError.invalidRequest }
            let request = try JSONDecoder().decode(NativeRequest.self, from: data)
            guard request.version == 1, request.action == "snapshot" else { throw NativeProtocolError.invalidRequest }
            return request
        } catch {
            throw NativeProtocolError.invalidRequest
        }
    }
}
