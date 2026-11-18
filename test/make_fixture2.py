import pikepdf, sys
from pikepdf import Pdf, Name, Dictionary, Array, Stream
from fontTools.ttLib import TTFont
# like Acrobat's edited text: embedded TrueType, WinAnsi, generic BaseFont "*Verdana-Italic-5441"
ttf = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf'
tt = TTFont(ttf); upm = tt['head'].unitsPerEm; hmtx = tt['hmtx']; cmap = tt.getBestCmap()
def w(code):
    g = cmap.get(code)
    return round(hmtx[g][0] * 1000 / upm) if g else 0
widths = [w(c) for c in range(32, 256)]
pdf = Pdf.new(); page = pdf.add_blank_page(page_size=(600, 800))
ff = Stream(pdf, open(ttf, 'rb').read()); ff.Length1 = len(open(ttf, 'rb').read())
desc = pdf.make_indirect(Dictionary(Type=Name.FontDescriptor, FontName=Name('/ABCDEF+*Verdana-Italic-5441'), Flags=96, ItalicAngle=-11,
    Ascent=928, Descent=-236, CapHeight=729, StemV=80, FontBBox=Array([-200, -250, 1200, 1000]), FontFile2=pdf.make_indirect(ff)))
font = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.TrueType, BaseFont=Name('/ABCDEF+*Verdana-Italic-5441'),
    Encoding=Name.WinAnsiEncoding, FirstChar=32, LastChar=255, Widths=Array(widths), FontDescriptor=desc))
img = Stream(pdf, bytes([200 if (x + y) % 2 else 120 for y in range(8) for x in range(8)] * 3))
img.Type = Name.XObject; img.Subtype = Name.Image; img.Width = 8; img.Height = 8; img.ColorSpace = Name.DeviceRGB; img.BitsPerComponent = 8
page.Resources = Dictionary(XObject=Dictionary(Im0=img), Font=Dictionary(F1=font))
page.Contents = Stream(pdf, b"""
q 600 0 0 800 0 0 cm /Im0 Do Q
q 1 1 1 rg 100 600 320 140 re f Q
BT /F1 20 Tf 0 g 1 0 0 1 120 700 Tm (My body had finally) Tj 0 -24 Td (begun to rebel) Tj 0 -24 Td (against going) Tj ET
BT /F1 16 Tf 0 g 1 0 0 1 120 200 Tm (Other bubble stays) Tj ET
""")
pdf.save(sys.argv[1])
