from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import math
import sys

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.local/demo-video/art')
OUT.mkdir(parents=True, exist_ok=True)
W, H, S = 1920, 1080, 2
BG = '#10162b'
INK = '#f4f0e7'
ACCENT = '#aaadff'
LIGHT = '#c5c6ff'
MUTED = '#a2abc3'
LINE = '#303850'
FONTS = Path('/System/Library/Fonts/Supplemental')


def font(size, kind='sans'):
    names = {'sans': 'Arial.ttf', 'bold': 'Arial Bold.ttf', 'serif': 'Georgia.ttf', 'italic': 'Georgia Italic.ttf'}
    return ImageFont.truetype(str(FONTS / names[kind]), round(size * S))


def canvas():
    return Image.new('RGB', (W * S, H * S), BG)


def text(im, content, x, y, size=30, kind='sans', fill=INK):
    draw = ImageDraw.Draw(im)
    face = font(size, kind)
    baseline = round(y * S) - face.getbbox('H', anchor='ls')[1]
    draw.text((round(x * S), baseline), content, font=face, fill=fill, anchor='ls')
    return draw.textlength(content, font=face) / S


def tracked(im, content, x, y, size=24, spacing=3, fill=MUTED):
    for character in content:
        x += text(im, character, x, y, size, 'sans', fill) + spacing
    return x


def line(im, y, x1=120, x2=1800):
    ImageDraw.Draw(im).line((x1 * S, y * S, x2 * S, y * S), fill=LINE, width=S)


def brand(im, x, y, size=64, kind='bold'):
    width = text(im, 'blurtReply', x, y, size, kind, INK)
    text(im, '.', x + width, y, size, kind, ACCENT)


def waveform(im, x, y, width=680, height=360):
    # Same 29-strand geometry as the app's VoiceForm, rendered at double size.
    layer = Image.new('RGBA', im.size)
    draw = ImageDraw.Draw(layer)
    sx, sy = width / 600, height / 280
    draw.line((x * S, (y + height / 2) * S, (x + width) * S, (y + height / 2) * S), fill=(170, 173, 255, 30), width=S)
    for strand in range(29):
        offset = (strand - 14) / 14
        points = []
        for index in range(301):
            position = index / 300
            envelope = math.sin(position * math.pi) ** 1.8
            twist = math.sin(position * math.pi * 2.25 + offset * 1.4)
            px = 20 + position * 560
            py = 140 + envelope * (twist * 51 + offset * 46 * math.cos(position * math.pi * 1.6))
            points.append(((x + px * sx) * S, (y + py * sy) * S))
        alpha = round((.20 + (1 - abs(offset)) * .5) * 255)
        draw.line(points, fill=(170, 173, 255, alpha), width=3 if strand == 14 else 2)
    for px in [20, 580]:
        cx, cy, radius = (x + px * sx) * S, (y + height / 2) * S, 2.5 * S
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(197, 198, 255, 235))
    im.paste(Image.alpha_composite(im.convert('RGBA'), layer).convert('RGB'))


def save(im, name):
    im.resize((W, H), Image.Resampling.LANCZOS).save(OUT / name, optimize=True)


im = canvas()
tracked(im, 'REPLY · AI ON CAMPUS', 120, 95, 24, 3.3)
line(im, 155)
brand(im, 118, 278, 202, 'serif')
text(im, 'Explain your course.', 126, 570, 76, 'serif')
text(im, 'Find what needs another look.', 126, 668, 67, 'italic', LIGHT)
waveform(im, 1118, 290, 710, 430)
line(im, 904)
text(im, 'Voice revision from your own notes', 124, 951, 30, fill=MUTED)
tracked(im, 'HACKATHON DEMO', 1456, 957, 20, 2.2)
save(im, 'intro.png')

im = canvas()
brand(im, 120, 94, 60)
tracked(im, 'KEEP EXPLAINING.', 1455, 117, 22, 2.4)
line(im, 190)
text(im, 'Your notes. A conversation.', 120, 350, 102, 'serif')
text(im, 'A clearer next step.', 124, 498, 112, 'italic', LIGHT)
waveform(im, 1135, 655, 680, 240)
line(im, 904)
text(im, 'Narration & AI examiner: ElevenLabs', 124, 951, 29, fill=MUTED)
save(im, 'outro.png')

im = canvas()
brand(im, 120, 94, 76)
tracked(im, 'REPLY · AI ON CAMPUS', 1374, 123, 22, 2.4)
line(im, 205)
text(im, 'Explain it.', 120, 326, 126, 'serif')
text(im, 'Find the gap.', 122, 482, 126, 'italic', LIGHT)
text(im, 'Voice revision from your own notes.', 126, 678, 36, fill=MUTED)
waveform(im, 1030, 320, 800, 460)
line(im, 904)
text(im, 'Narration & AI examiner: ElevenLabs', 124, 951, 30, fill=MUTED)
save(im, 'poster.png')
print('Rendered three 1920 x 1080 RGB cards.')
