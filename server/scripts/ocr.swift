import Foundation
import Vision
import AppKit

// 用法：swift ocr.swift <image_path>
// 输出：识别到的文本（UTF-8），失败输出空行

guard CommandLine.arguments.count > 1 else {
    FileHandle.standardError.write("用法: ocr.swift <image_path>\n".data(using: .utf8)!)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
guard let image = NSImage(contentsOfFile: imagePath),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write("无法加载图片: \(imagePath)\n".data(using: .utf8)!)
    exit(1)
}

let request = VNRecognizeTextRequest { request, error in
    if let error = error {
        FileHandle.standardError.write("OCR 错误: \(error.localizedDescription)\n".data(using: .utf8)!)
        exit(1)
    }
    guard let observations = request.results as? [VNRecognizedTextObservation] else {
        print("")
        exit(0)
    }
    var lines: [String] = []
    for observation in observations {
        if let topCandidate = observation.topCandidates(1).first {
            lines.append(topCandidate.string)
        }
    }
    print(lines.joined(separator: "\n"))
    exit(0)
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("识别失败: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}

// 等待回调
RunLoop.current.run(until: Date(timeIntervalSinceNow: 30))
