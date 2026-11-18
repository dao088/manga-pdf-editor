import pikepdf, sys
from pikepdf import Pdf, Name, Dictionary, Array, Stream
pdf = Pdf.new()
page = pdf.add_blank_page(page_size=(600, 800))
# background raster (stands in for the manga art)
img = Stream(pdf, bytes([200 if (x+y)%2 else 120 for y in range(8) for x in range(8)]*3))
img.Type = Name.XObject; img.Subtype = Name.Image; img.Width = 8; img.Height = 8
img.ColorSpace = Name.DeviceRGB; img.BitsPerComponent = 8
def font(base, widths=None, flags=96, angle=-12):
    d = Dictionary(Type=Name.Font, Subtype=Name.TrueType, BaseFont=Name('/'+base), Encoding=Name.WinAnsiEncoding)
    if widths:
        d.FirstChar = 32; d.LastChar = 255; d.Widths = Array(widths)
        d.FontDescriptor = pdf.make_indirect(Dictionary(Type=Name.FontDescriptor, FontName=Name('/'+base), Flags=flags,
            ItalicAngle=angle, Ascent=1005, Descent=-210, CapHeight=727, StemV=80, FontBBox=Array([-200,-250,1200,1000])))
    return pdf.make_indirect(d)
W = [600]*224
W[0] = 352  # space
page.Resources = Dictionary(
    XObject=Dictionary(Im0=img),
    Font=Dictionary(F1=font('Verdana-Italic', W), F2=pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica))))
content = b"""
q 600 0 0 800 0 0 cm /Im0 Do Q
q 1 1 1 rg 100 600 320 140 re f Q
BT /F1 20 Tf 0 g 1 0 0 1 120 700 Tm [(My body ) -10 (had finally)] TJ 0 -24 Td (begun to rebel) Tj 0 -24 Td (against going) Tj ET
BT /F2 14 Tf 0 g 1 0 0 1 120 300 Tm (Keep me untouched) Tj ET
BT /F1 16 Tf 0 g 1 0 0 1 120 200 Tm (Other bubble stays) Tj ET
"""
s = Stream(pdf, content)
page.Contents = s
pdf.save(sys.argv[1])
