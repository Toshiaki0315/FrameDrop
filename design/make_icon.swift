// Generates design/app-icon-1024.png — run: swiftc design/make_icon.swift -o /tmp/make_icon && /tmp/make_icon design/app-icon-1024.png
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

let size = 1024
let cs = CGColorSpaceCreateDeviceRGB()
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

func color(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: a)
}

// Background: macOS-style rounded square with a sunset gradient
let inset: CGFloat = 100
let bgRect = CGRect(x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
let bgPath = CGPath(roundedRect: bgRect, cornerWidth: 190, cornerHeight: 190, transform: nil)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 28, color: color(0x000000, 0.28))
ctx.addPath(bgPath); ctx.setFillColor(color(0xF2557C)); ctx.fillPath()
ctx.restoreGState()
ctx.saveGState()
ctx.addPath(bgPath); ctx.clip()
let grad = CGGradient(colorsSpace: cs,
                      colors: [color(0xFFB36B), color(0xF2557C), color(0x7B4BD8)] as CFArray,
                      locations: [0, 0.55, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: bgRect.minX, y: bgRect.maxY),
                       end: CGPoint(x: bgRect.maxX, y: bgRect.minY), options: [])
// soft highlight
let hl = CGGradient(colorsSpace: cs, colors: [color(0xFFFFFF, 0.28), color(0xFFFFFF, 0)] as CFArray, locations: [0, 1])!
ctx.drawRadialGradient(hl, startCenter: CGPoint(x: 360, y: 840), startRadius: 0,
                       endCenter: CGPoint(x: 360, y: 840), endRadius: 520, options: [])
ctx.restoreGState()

// Frames falling into a stack ("drop")
func card(angle: CGFloat, dx: CGFloat, dy: CGFloat, alpha: CGFloat, w: CGFloat = 470, h: CGFloat = 350) {
    ctx.saveGState()
    ctx.translateBy(x: 512 + dx, y: 500 + dy)
    ctx.rotate(by: angle * .pi / 180)
    let r = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
    let p = CGPath(roundedRect: r, cornerWidth: 46, cornerHeight: 46, transform: nil)
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 22, color: color(0x3A1040, 0.28))
    ctx.addPath(p); ctx.setFillColor(color(0xFFFFFF, alpha)); ctx.fillPath()
    ctx.restoreGState()
}
card(angle: -14, dx: -40, dy: 70, alpha: 0.45)
card(angle: 9, dx: 38, dy: 36, alpha: 0.7)
card(angle: -2, dx: 0, dy: 0, alpha: 1)

// Top frame: scene with sun, hills and a play button
ctx.saveGState()
ctx.translateBy(x: 512, y: 500)
ctx.rotate(by: -2 * .pi / 180)
let inner = CGRect(x: -205, y: -140, width: 410, height: 280)
let innerPath = CGPath(roundedRect: inner, cornerWidth: 28, cornerHeight: 28, transform: nil)
ctx.addPath(innerPath); ctx.clip()
let sky = CGGradient(colorsSpace: cs, colors: [color(0xFFE3C2), color(0xFFB8C9)] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(sky, start: CGPoint(x: 0, y: 140), end: CGPoint(x: 0, y: -140), options: [])
ctx.setFillColor(color(0xFFFFFF, 0.9))
ctx.fillEllipse(in: CGRect(x: 60, y: 30, width: 90, height: 90))
ctx.setFillColor(color(0xF2557C, 0.85))
let hill = CGMutablePath()
hill.move(to: CGPoint(x: -230, y: -140)); hill.addLine(to: CGPoint(x: -230, y: -40))
hill.addQuadCurve(to: CGPoint(x: 20, y: -60), control: CGPoint(x: -110, y: 40))
hill.addQuadCurve(to: CGPoint(x: 230, y: -30), control: CGPoint(x: 130, y: -120))
hill.addLine(to: CGPoint(x: 230, y: -140)); hill.closeSubpath()
ctx.addPath(hill); ctx.fillPath()
ctx.restoreGState()

// Play badge
ctx.saveGState()
ctx.translateBy(x: 512, y: 500)
ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 14, color: color(0x3A1040, 0.35))
ctx.setFillColor(color(0x7B4BD8))
ctx.fillEllipse(in: CGRect(x: -64, y: -64, width: 128, height: 128))
ctx.setShadow(offset: .zero, blur: 0, color: nil)
ctx.setFillColor(color(0xFFFFFF))
let tri = CGMutablePath()
tri.move(to: CGPoint(x: -18, y: -34)); tri.addLine(to: CGPoint(x: -18, y: 34)); tri.addLine(to: CGPoint(x: 40, y: 0))
tri.closeSubpath()
ctx.addPath(tri); ctx.fillPath()
ctx.restoreGState()

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "app-icon-1024.png")
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
CGImageDestinationFinalize(dest)
print("wrote \(out.path)")
