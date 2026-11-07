// Generates the test images in sample/ (every supported format, with transparent variants
// for formats that can carry alpha) and sample stamps.
//
//   swiftc design/make_samples.swift -o /tmp/make_samples && /tmp/make_samples sample
//
// Needs macOS `sips` (TIFF/HEIC/BMP/GIF/JPEG) and `cwebp` (WebP: `brew install webp`).
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// MARK: - Drawing helpers

let cs = CGColorSpaceCreateDeviceRGB()

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

func render(_ w: Int, _ h: Int, _ draw: (CGContext) -> Void) -> CGImage {
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    draw(ctx)
    return ctx.makeImage()!
}

func savePNG(_ image: CGImage, _ path: String) {
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, nil)
    CGImageDestinationFinalize(dest)
}

func text(_ ctx: CGContext, _ s: String, x: CGFloat, y: CGFloat, size: CGFloat, _ c: CGColor) {
    let font = CTFontCreateWithName("HelveticaNeue-Bold" as CFString, size, nil)
    let attrs: [CFString: Any] = [kCTFontAttributeName: font, kCTForegroundColorAttributeName: c]
    let line = CTLineCreateWithAttributedString(CFAttributedStringCreate(nil, s as CFString, attrs as CFDictionary)!)
    ctx.textPosition = CGPoint(x: x, y: y)
    CTLineDraw(line, ctx)
}

func gradient(_ ctx: CGContext, _ c1: CGColor, _ c2: CGColor, from: CGPoint, to: CGPoint) {
    let g = CGGradient(colorsSpace: cs, colors: [c1, c2] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(g, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

// MARK: - Test pictures

/// Opaque picture: gradient, grid, shapes, a big label and corner markers
/// (so cropping, padding and scaling are easy to see).
func opaqueScene(_ w: Int, _ h: Int, hue: [CGFloat], label: String) -> CGImage {
    render(w, h) { ctx in
        let W = CGFloat(w), H = CGFloat(h)
        gradient(ctx, color(hue[0], hue[1], hue[2]), color(hue[2], hue[0], hue[1]), from: .zero, to: CGPoint(x: W, y: H))
        ctx.setStrokeColor(color(255, 255, 255, 0.18)); ctx.setLineWidth(2)
        var x: CGFloat = 0
        while x < W { ctx.move(to: CGPoint(x: x, y: 0)); ctx.addLine(to: CGPoint(x: x, y: H)); x += 100 }
        var y: CGFloat = 0
        while y < H { ctx.move(to: CGPoint(x: 0, y: y)); ctx.addLine(to: CGPoint(x: W, y: y)); y += 100 }
        ctx.strokePath()
        ctx.setFillColor(color(255, 255, 255, 0.35))
        ctx.fillEllipse(in: CGRect(x: W * 0.62, y: H * 0.45, width: min(W, H) * 0.42, height: min(W, H) * 0.42))
        ctx.setFillColor(color(0, 0, 0, 0.22))
        ctx.fill(CGRect(x: W * 0.08, y: H * 0.1, width: W * 0.3, height: H * 0.22))
        text(ctx, label, x: W * 0.06, y: H * 0.55, size: min(W, H) * 0.09, color(255, 255, 255))
        text(ctx, "\(w) x \(h)", x: W * 0.06, y: H * 0.42, size: min(W, H) * 0.06, color(255, 255, 255, 0.9))
        let m = min(W, H) * 0.05
        for (cx, cy, c) in [(0.0, 0.0, color(255, 60, 60)), (W - m, 0.0, color(60, 255, 60)),
                            (0.0, H - m, color(60, 60, 255)), (W - m, H - m, color(255, 255, 60))] {
            ctx.setFillColor(c); ctx.fill(CGRect(x: cx, y: cy, width: m, height: m))
        }
    }
}

/// Picture with transparency: transparent corners, a soft radial blob whose edge fades out
/// (semi-transparent pixels), a half-transparent band and an opaque ring.
func transparentScene(_ w: Int, _ h: Int, hue: [CGFloat], label: String) -> CGImage {
    render(w, h) { ctx in
        let W = CGFloat(w), H = CGFloat(h)
        let center = CGPoint(x: W / 2, y: H / 2), radius = min(W, H) * 0.5
        let g = CGGradient(colorsSpace: cs,
                           colors: [color(hue[0], hue[1], hue[2], 1), color(hue[2], hue[0], hue[1], 0.85), color(hue[1], hue[2], hue[0], 0)] as CFArray,
                           locations: [0, 0.65, 1])!
        ctx.drawRadialGradient(g, startCenter: center, startRadius: 0, endCenter: center, endRadius: radius, options: [])
        ctx.setFillColor(color(255, 255, 255, 0.5))
        ctx.fill(CGRect(x: W * 0.12, y: H * 0.18, width: W * 0.76, height: H * 0.14))
        ctx.setStrokeColor(color(255, 255, 255)); ctx.setLineWidth(max(6, min(W, H) * 0.012))
        ctx.strokeEllipse(in: CGRect(x: center.x - radius * 0.55, y: center.y - radius * 0.55, width: radius * 1.1, height: radius * 1.1))
        text(ctx, label, x: W * 0.22, y: H * 0.52, size: min(W, H) * 0.09, color(255, 255, 255))
        text(ctx, "transparent \(w)x\(h)", x: W * 0.22, y: H * 0.42, size: min(W, H) * 0.05, color(255, 255, 255, 0.95))
    }
}

// MARK: - Stamps

func starPath(_ c: CGPoint, outer: CGFloat, inner: CGFloat) -> CGPath {
    let p = CGMutablePath()
    for i in 0..<10 {
        let a = CGFloat.pi / 2 + CGFloat(i) * CGFloat.pi / 5
        let r = i % 2 == 0 ? outer : inner
        let pt = CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r)
        i == 0 ? p.move(to: pt) : p.addLine(to: pt)
    }
    p.closeSubpath()
    return p
}

/// Gold star with an antialiased edge and (optionally) a soft drop shadow, i.e. semi-transparent
/// pixels. GIF only has on/off transparency, so its stamp is made without the shadow.
func starStamp(_ size: Int, opaqueBackground: Bool, shadow: Bool = true) -> CGImage {
    render(size, size) { ctx in
        let S = CGFloat(size), c = CGPoint(x: S / 2, y: S / 2 + S * 0.03)
        if opaqueBackground { ctx.setFillColor(color(255, 255, 255)); ctx.fill(CGRect(x: 0, y: 0, width: S, height: S)) }
        let star = starPath(c, outer: S * 0.4, inner: S * 0.17)
        ctx.saveGState()
        if shadow { ctx.setShadow(offset: CGSize(width: S * 0.025, height: -S * 0.035), blur: S * 0.05, color: color(0, 0, 0, 0.55)) }
        ctx.addPath(star); ctx.setFillColor(color(255, 200, 40)); ctx.fillPath()
        ctx.restoreGState()
        ctx.saveGState()
        ctx.addPath(star); ctx.clip()
        gradient(ctx, color(255, 240, 120), color(240, 130, 20), from: CGPoint(x: 0, y: S), to: CGPoint(x: S, y: 0))
        ctx.restoreGState()
        ctx.addPath(star); ctx.setStrokeColor(color(150, 70, 0)); ctx.setLineWidth(S * 0.018); ctx.strokePath()
    }
}

/// Wide, half-transparent banner: tests the aspect ratio and alpha blending.
func bannerStamp() -> CGImage {
    render(480, 140) { ctx in
        let r = CGRect(x: 6, y: 6, width: 468, height: 128)
        ctx.addPath(CGPath(roundedRect: r, cornerWidth: 30, cornerHeight: 30, transform: nil))
        ctx.setFillColor(color(20, 20, 60, 0.6)); ctx.fillPath()
        text(ctx, "SAMPLE", x: 62, y: 42, size: 72, color(255, 255, 255))
    }
}

// MARK: - Conversion

@discardableResult
func run(_ args: [String]) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = args
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return false }
    p.waitUntilExit()
    return p.terminationStatus == 0
}

func convert(_ png: String, to path: String, _ format: String) {
    let ok: Bool
    switch format {
    case "webp": ok = run(["cwebp", "-quiet", "-lossless", png, "-o", path])
    case "jpeg": ok = run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "90", png, "--out", path])
    default: ok = run(["sips", "-s", "format", format, png, "--out", path])
    }
    print(ok ? "  ok    \(path)" : "  FAILED \(path)  (\(format))")
}

// MARK: - Main

let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "sample"
let fm = FileManager.default
let tmp = NSTemporaryDirectory() + "framedrop-samples-\(getpid())"
for d in ["\(root)/images", "\(root)/stamps", tmp] { try? fm.createDirectory(atPath: d, withIntermediateDirectories: true) }

struct Pic { let name: String; let format: String; let w: Int; let h: Int; let hue: [CGFloat]; let transparent: Bool }
let pics: [Pic] = [
    Pic(name: "01_jpeg_landscape.jpg", format: "jpeg", w: 1600, h: 900, hue: [235, 90, 90], transparent: false),
    Pic(name: "02_jpeg_portrait.jpg", format: "jpeg", w: 900, h: 1200, hue: [60, 160, 235], transparent: false),
    Pic(name: "03_png_landscape.png", format: "png", w: 1600, h: 900, hue: [70, 190, 120], transparent: false),
    Pic(name: "04_png_square.png", format: "png", w: 1200, h: 1200, hue: [150, 90, 220], transparent: false),
    Pic(name: "05_png_transparent.png", format: "png", w: 1400, h: 900, hue: [235, 120, 60], transparent: true),
    Pic(name: "06_gif_landscape.gif", format: "gif", w: 800, h: 450, hue: [220, 80, 150], transparent: false),
    Pic(name: "07_gif_transparent.gif", format: "gif", w: 800, h: 600, hue: [40, 170, 200], transparent: true),
    Pic(name: "08_bmp_landscape.bmp", format: "bmp", w: 1200, h: 800, hue: [200, 170, 50], transparent: false),
    Pic(name: "09_tiff_landscape.tiff", format: "tiff", w: 1600, h: 900, hue: [90, 120, 230], transparent: false),
    Pic(name: "10_tiff_transparent.tiff", format: "tiff", w: 1200, h: 900, hue: [230, 70, 110], transparent: true),
    Pic(name: "11_webp_landscape.webp", format: "webp", w: 1280, h: 720, hue: [60, 200, 170], transparent: false),
    Pic(name: "12_webp_transparent.webp", format: "webp", w: 1000, h: 1000, hue: [240, 160, 40], transparent: true),
    Pic(name: "13_heic_landscape.heic", format: "heic", w: 1600, h: 900, hue: [120, 80, 200], transparent: false),
    Pic(name: "14_heic_portrait.heic", format: "heic", w: 900, h: 1200, hue: [220, 100, 70], transparent: false),
    Pic(name: "15_heic_transparent.heic", format: "heic", w: 1200, h: 900, hue: [50, 150, 230], transparent: true),
]

print("images:")
for p in pics {
    let label = String(p.name.dropFirst(3).split(separator: ".")[0]).replacingOccurrences(of: "_", with: " ").uppercased()
    let img = p.transparent ? transparentScene(p.w, p.h, hue: p.hue, label: label) : opaqueScene(p.w, p.h, hue: p.hue, label: label)
    let master = "\(tmp)/\(p.name).png"
    savePNG(img, master)
    if p.format == "png" {
        try? fm.removeItem(atPath: "\(root)/images/\(p.name)")
        try? fm.copyItem(atPath: master, toPath: "\(root)/images/\(p.name)")
        print("  ok    \(root)/images/\(p.name)")
    } else {
        convert(master, to: "\(root)/images/\(p.name)", p.format)
    }
}

print("stamps:")
let starFlat = "\(tmp)/star_flat.png", starMaster = "\(tmp)/star.png", starOpaque = "\(tmp)/star_opaque.png", bannerMaster = "\(tmp)/banner.png"
savePNG(starStamp(256, opaqueBackground: false), starMaster)
savePNG(starStamp(256, opaqueBackground: false, shadow: false), starFlat)
savePNG(starStamp(256, opaqueBackground: true), starOpaque)
savePNG(bannerStamp(), bannerMaster)
for (src, name, format) in [
    (starMaster, "stamp_star.png", "png"), (starFlat, "stamp_star.gif", "gif"),
    (starMaster, "stamp_star.tiff", "tiff"), (starMaster, "stamp_star.webp", "webp"),
    (starMaster, "stamp_star.heic", "heic"), (starOpaque, "stamp_star_opaque.jpg", "jpeg"),
    (starOpaque, "stamp_star_opaque.bmp", "bmp"), (bannerMaster, "stamp_banner.png", "png"),
] {
    let dst = "\(root)/stamps/\(name)"
    if format == "png" { try? fm.removeItem(atPath: dst); try? fm.copyItem(atPath: src, toPath: dst); print("  ok    \(dst)") }
    else { convert(src, to: dst, format) }
}
try? fm.removeItem(atPath: tmp)
