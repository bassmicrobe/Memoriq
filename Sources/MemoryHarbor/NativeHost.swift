import Foundation
import MemoryCore

enum NativeHost {
    private struct Response: Encodable {
        let ok: Bool
        let data: MemorySnapshot?
        let error: String?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: Keys.self)
            try container.encode(ok, forKey: .ok)
            try container.encode(data, forKey: .data)
            try container.encode(error, forKey: .error)
        }
        private enum Keys: String, CodingKey { case ok, data, error }
    }

    static func printSnapshot() {
        do {
            let data = try JSONEncoder().encode(MemorySampler.sample())
            FileHandle.standardOutput.write(data + Data([10]))
        } catch {
            log("メモリ情報を取得できません: \(error)")
            exit(1)
        }
    }

    static func run(origin: String?) {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "MemoryHarborExtensionID") as? String,
              id.count == 32, id.allSatisfy({ ("a"..."p").contains(String($0)) }),
              origin == "chrome-extension://\(id)/" else {
            log("Native Messaging: 許可されていない接続元です。")
            exit(77)
        }
        do {
            while let header = try readExactly(4, allowEOF: true) {
                let length = try NativeMessageFraming.decodeLength(header)
                guard let payload = try readExactly(length, allowEOF: false) else {
                    throw HostError.incompleteInput
                }
                let response: Response
                do {
                    _ = try NativeRequest.decode(payload)
                    response = Response(ok: true, data: try MemorySampler.sample(), error: nil)
                } catch {
                    log("Native Messaging request: \(error)")
                    response = Response(ok: false, data: nil, error: "要求を処理できません。形式とアプリの状態を確認してください。")
                }
                let frame = try NativeMessageFraming.encode(JSONEncoder().encode(response))
                try FileHandle.standardOutput.write(contentsOf: frame)
            }
        } catch {
            log("Native Messaging stream: \(error)")
            exit(1)
        }
    }

    private static func readExactly(_ count: Int, allowEOF: Bool) throws -> Data? {
        var data = Data()
        while data.count < count {
            guard let chunk = try FileHandle.standardInput.read(upToCount: count - data.count), !chunk.isEmpty else {
                if data.isEmpty && allowEOF { return nil }
                throw HostError.incompleteInput
            }
            data = data + chunk
        }
        return data
    }

    private static func log(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }

    private enum HostError: Error { case incompleteInput }
}
