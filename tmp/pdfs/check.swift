import AppKit
import PDFKit
let doc = PDFDocument(url: URL(fileURLWithPath: "output/pdf/pitch-deck-20261010.pdf"))!
print("Pages: \(doc.pageCount)")
let cellW = 640, cellH = 360
let image = NSImage(size: NSSize(width: cellW * 3, height: cellH * 4))
image.lockFocus()
NSColor.white.setFill()
NSRect(x:0,y:0,width:cellW*3,height:cellH*4).fill()
for i in 0..<doc.pageCount {
 let page = doc.page(at:i)!
 print("Page \(i+1): \(page.bounds(for:.mediaBox)) text characters: \(page.string?.count ?? 0)")
 let thumb = page.thumbnail(of:NSSize(width:cellW,height:cellH),for:.mediaBox)
 thumb.draw(in:NSRect(x:(i%3)*cellW,y:(3-i/3)*cellH,width:cellW,height:cellH))
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"tmp/pdfs/review.png"))
