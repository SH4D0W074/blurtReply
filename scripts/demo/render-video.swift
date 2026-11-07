// Native macOS demo renderer. No third-party packages or network access.
// Build: swiftc -parse-as-library scripts/demo/render-video.swift -o .local/demo-video/render-video
// Run:   .local/demo-video/render-video path/to/manifest.json
import Foundation
import AVFoundation
import CoreGraphics
import CoreText
import ImageIO

private struct Manifest: Decodable {
    let output: String
    let width: Int
    let height: Int
    let fps: Int
    let duration: Double
    let frames: [Frame]
    let audio: [AudioClip]
}
private struct Frame: Decodable {
    enum Kind: String, Decodable { case screen, card }
    let at: Double
    let file: String
    let kind: Kind
    let title: String?
    let subtitle: String?
}
private struct AudioClip: Decodable {
    let file: String
    let at: Double
    let trimStart: Double?
    let duration: Double?
}
private struct RenderError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

private func fileURL(_ path: String, relativeTo directory: URL) -> URL {
    if path.hasPrefix("/") { return URL(fileURLWithPath: path).standardizedFileURL }
    return directory.appendingPathComponent(path).standardizedFileURL
}

private func validate(_ manifest: Manifest, directory: URL) throws {
    guard manifest.width == 1920, manifest.height == 1080 else {
        throw RenderError("This layout requires width 1920 and height 1080.")
    }
    guard (1...60).contains(manifest.fps), manifest.duration.isFinite,
          manifest.duration > 0, manifest.duration <= 600 else {
        throw RenderError("Use 1–60 fps and a finite duration between 0 and 600 seconds.")
    }
    guard !manifest.frames.isEmpty, manifest.frames[0].at == 0 else {
        throw RenderError("The frames list must begin at time 0.")
    }
    var last = -Double.infinity
    for frame in manifest.frames {
        guard frame.at.isFinite, frame.at >= last, frame.at >= 0, frame.at < manifest.duration else {
            throw RenderError("Frame times must be sorted and fall within the video duration.")
        }
        last = frame.at
        guard FileManager.default.fileExists(atPath: fileURL(frame.file, relativeTo: directory).path) else {
            throw RenderError("Missing image: \(frame.file)")
        }
    }
    for clip in manifest.audio {
        guard clip.at.isFinite, clip.at >= 0, clip.at < manifest.duration,
              (clip.trimStart ?? 0).isFinite, (clip.trimStart ?? 0) >= 0,
              clip.duration == nil || (clip.duration!.isFinite && clip.duration! > 0) else {
            throw RenderError("Audio times must be finite and nonnegative; durations must be positive.")
        }
        guard FileManager.default.fileExists(atPath: fileURL(clip.file, relativeTo: directory).path) else {
            throw RenderError("Missing audio: \(clip.file)")
        }
    }
}

private func loadImage(_ url: URL, maximumSize: Int) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumSize,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
          ] as CFDictionary) else {
        throw RenderError("Could not decode image: \(url.lastPathComponent)")
    }
    return image
}

@discardableResult
private func drawLine(_ text: String, size: CGFloat, medium: Bool = false, x: CGFloat, top: CGFloat,
                      width: CGFloat, color: CGColor, context: CGContext, height: CGFloat) -> CGFloat {
    let font = CTFontCreateWithName((medium ? "HelveticaNeue-Medium" : "HelveticaNeue") as CFString, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ]
    let sanitized = String(text.replacingOccurrences(of: "\n", with: " ").prefix(120))
    let original = CTLineCreateWithAttributedString(NSAttributedString(string: sanitized, attributes: attributes))
    let ellipsis = CTLineCreateWithAttributedString(NSAttributedString(string: "…", attributes: attributes))
    let line = CTLineCreateTruncatedLine(original, Double(width), .end, ellipsis) ?? original
    context.saveGState()
    context.textMatrix = .identity
    context.textPosition = CGPoint(x: x, y: height - top - size)
    CTLineDraw(line, context)
    context.restoreGState()
    return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
}

private func paint(_ frame: Frame, image: CGImage, into pixelBuffer: CVPixelBuffer, manifest: Manifest) throws {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer),
          let context = CGContext(data: base, width: manifest.width, height: manifest.height,
                                  bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) else {
        throw RenderError("Could not create the video drawing surface.")
    }
    let width = CGFloat(manifest.width), height = CGFloat(manifest.height)
    context.interpolationQuality = .high
    context.setFillColor(CGColor(red: 10 / 255, green: 16 / 255, blue: 34 / 255, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    if frame.kind == .card {
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        if (frame.title ?? "").isEmpty { return }
        // Keep spoken captions visible on the opening card as well as screen footage.
        context.setFillColor(CGColor(red: 10 / 255, green: 16 / 255, blue: 34 / 255, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: 145))
    } else {
        context.draw(image, in: CGRect(x: 60, y: height - 40 - 900, width: 1800, height: 900))
    }
    let titleWidth = drawLine(frame.title ?? "", size: 36, medium: true, x: 60, top: 960,
                              width: 1800, color: CGColor(gray: 0.97, alpha: 1), context: context, height: height)
    drawLine(frame.subtitle ?? "", size: 25, x: 60, top: 1014, width: 1800,
             color: CGColor(red: 0.66, green: 0.70, blue: 0.80, alpha: 1), context: context, height: height)
    if titleWidth < 1440 {
        drawLine("blurtReply.", size: 28, medium: true, x: 1680, top: 967, width: 180,
                 color: CGColor(red: 0.70, green: 0.69, blue: 1, alpha: 1), context: context, height: height)
    }
}

private func makeVideo(_ manifest: Manifest, directory: URL, temporary: URL) async throws {
    let writer = try AVAssetWriter(outputURL: temporary, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: manifest.width,
        AVVideoHeightKey: manifest.height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 8_000_000,
            AVVideoExpectedSourceFrameRateKey: manifest.fps,
            AVVideoMaxKeyFrameIntervalKey: manifest.fps * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            AVVideoAllowFrameReorderingKey: false,
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: manifest.width,
        kCVPixelBufferHeightKey as String: manifest.height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ])
    guard writer.canAdd(input) else { throw RenderError("H.264 video encoding is unavailable.") }
    writer.add(input)
    guard writer.startWriting() else { throw writer.error ?? RenderError("Video encoder could not start.") }
    writer.startSession(atSourceTime: .zero)
    guard let pool = adaptor.pixelBufferPool else { throw RenderError("Video encoder did not allocate a frame pool.") }
    let count = Int(ceil(manifest.duration * Double(manifest.fps)))
    var frameIndex = 0
    var decodedFile: String?
    var decodedImage: CGImage?
    for index in 0..<count {
        while !input.isReadyForMoreMediaData {
            guard writer.status == .writing else { throw writer.error ?? RenderError("Video encoder stopped accepting frames.") }
            try await Task.sleep(nanoseconds: 2_000_000)
        }
        let seconds = Double(index) / Double(manifest.fps)
        while frameIndex + 1 < manifest.frames.count && manifest.frames[frameIndex + 1].at <= seconds + 0.000001 {
            frameIndex += 1
        }
        let frame = manifest.frames[frameIndex]
        if decodedFile != frame.file {
            // Only the selected image is retained; previous captures are released.
            decodedImage = try loadImage(fileURL(frame.file, relativeTo: directory), maximumSize: max(manifest.width, manifest.height))
            decodedFile = frame.file
        }
        try autoreleasepool {
            var buffer: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer,
                  let image = decodedImage else { throw RenderError("Could not allocate a video frame.") }
            try paint(frame, image: image, into: buffer, manifest: manifest)
            let time = CMTime(value: CMTimeValue(index), timescale: CMTimeScale(manifest.fps))
            guard adaptor.append(buffer, withPresentationTime: time) else {
                throw writer.error ?? RenderError("Video encoder rejected frame \(index).")
            }
        }
        if index % (manifest.fps * 5) == 0 { print("Video: \(Int(seconds)) / \(manifest.duration) seconds") }
    }
    writer.endSession(atSourceTime: CMTime(seconds: manifest.duration, preferredTimescale: 60000))
    input.markAsFinished()
    await writer.finishWriting()
    guard writer.status == .completed else { throw writer.error ?? RenderError("Video encoding failed.") }
}

private func mixAudio(_ manifest: Manifest, directory: URL, video: URL, output: URL) async throws {
    let composition = AVMutableComposition()
    let sourceVideo = AVURLAsset(url: video)
    guard let videoSource = try await sourceVideo.loadTracks(withMediaType: .video).first,
          let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw RenderError("Could not open the encoded video track.")
    }
    let duration = CMTime(seconds: manifest.duration, preferredTimescale: 60000)
    try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: videoSource, at: .zero)
    videoTrack.preferredTransform = try await videoSource.load(.preferredTransform)
    var mixParameters: [AVAudioMixInputParameters] = []
    for (index, clip) in manifest.audio.enumerated() {
        let asset = AVURLAsset(url: fileURL(clip.file, relativeTo: directory))
        guard let source = try await asset.loadTracks(withMediaType: .audio).first,
              let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw RenderError("Audio clip \(index + 1) has no readable audio track.")
        }
        let sourceDuration = try await asset.load(.duration).seconds
        let start = clip.trimStart ?? 0
        guard sourceDuration.isFinite, sourceDuration > start else {
            throw RenderError("Audio clip \(index + 1) begins beyond its available audio.")
        }
        let length = min(clip.duration ?? (sourceDuration - start), sourceDuration - start, manifest.duration - clip.at)
        let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 60000),
                                duration: CMTime(seconds: length, preferredTimescale: 60000))
        try track.insertTimeRange(range, of: source, at: CMTime(seconds: clip.at, preferredTimescale: 60000))
        let parameters = AVMutableAudioMixInputParameters(track: track)
        parameters.setVolume(1, at: .zero)
        mixParameters.append(parameters)
        print("Audio \(index + 1): at \(clip.at)s, using \(length)s from \(start)s")
    }
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1920x1080) else {
        throw RenderError("Could not create the MP4 exporter.")
    }
    let mix = AVMutableAudioMix()
    mix.inputParameters = mixParameters
    exporter.audioMix = mix
    exporter.shouldOptimizeForNetworkUse = true
    exporter.timeRange = CMTimeRange(start: .zero, duration: duration)
    try await exporter.export(to: output, as: .mp4)
}

@main
private struct Renderer {
    static func main() async {
        do {
            guard CommandLine.arguments.count == 2 else {
                throw RenderError("Usage: render-video /path/to/manifest.json (relative media/output paths resolve beside the manifest)")
            }
            let manifestURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
            let directory = manifestURL.deletingLastPathComponent()
            let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
            try validate(manifest, directory: directory)
            let output = fileURL(manifest.output, relativeTo: directory)
            guard output.pathExtension.lowercased() == "mp4" else { throw RenderError("Output must use the .mp4 extension.") }
            guard !FileManager.default.fileExists(atPath: output.path) else { throw RenderError("Output already exists; choose a new path: \(output.path)") }
            try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
            let temporary = output.deletingLastPathComponent().appendingPathComponent(".render-\(UUID().uuidString).mp4")
            defer { try? FileManager.default.removeItem(at: temporary) }
            try await makeVideo(manifest, directory: directory, temporary: temporary)
            if manifest.audio.isEmpty {
                try FileManager.default.moveItem(at: temporary, to: output)
            } else {
                do { try await mixAudio(manifest, directory: directory, video: temporary, output: output) }
                catch { try? FileManager.default.removeItem(at: output); throw error }
            }
            let result = AVURLAsset(url: output)
            let duration = try await result.load(.duration).seconds
            let videoTracks = try await result.loadTracks(withMediaType: .video)
            let audioTracks = try await result.loadTracks(withMediaType: .audio)
            print("Saved \(output.path)")
            print("Verified: \(duration)s, \(videoTracks.count) video track, \(audioTracks.count) audio track(s)")
        } catch {
            FileHandle.standardError.write(Data("Render failed: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
