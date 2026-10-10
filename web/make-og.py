# Renders web/img/og.png (1200x630): the console screenshot in a frame with the logo and a line of copy.
# Run after make-shots.js: python web/make-og.py
import os
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 630
img = Image.new('RGB', (W, H), '#F3FAF9')
d = ImageDraw.Draw(img)
# soft gradient band
for y in range(H):
    t = y / H
    c = (int(243 + (255 - 243) * t), int(250 + (255 - 250) * t), int(249 + (255 - 249) * t))
    d.line([(0, y), (W, y)], fill=c)

def font(size, bold=True):
    for name in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()

logo = Image.open(os.path.join(here, 'logo.png')).convert('RGBA').resize((72, 72), Image.LANCZOS)
img.paste(logo, (64, 56), logo)
d.text((152, 62), 'Arena for Amazon Connect', font=font(40), fill='#14191F')
d.text((64, 170), 'A fair, live', font=font(54), fill='#14191F')
d.text((64, 232), 'leaderboard for', font=font(54), fill='#14191F')
d.text((64, 294), 'your agents', font=font(54), fill='#0F766E')
d.text((64, 384), 'Points from Connect data,', font=font(24, False), fill='#3D4650')
d.text((64, 416), 'not self-reporting. Coaching,', font=font(24, False), fill='#3D4650')
d.text((64, 448), 'challenges, rewards, reports.', font=font(24, False), fill='#3D4650')
d.rounded_rectangle([64, 500, 440, 556], radius=12, fill='#0F766E')
d.text((86, 513), '$0.75 per active agent-day', font=font(24), fill='#FFFFFF')

shot = Image.open(os.path.join(here, 'img', 'console.webp')).convert('RGB')
sw = 600
sh = int(shot.height * sw / shot.width)
shot = shot.resize((sw, sh), Image.LANCZOS)
frame = Image.new('RGB', (sw + 16, min(sh, 470) + 16), '#E3E7EA')
frame.paste(shot.crop((0, 0, sw, min(sh, 470))), (8, 8))
img.paste(frame, (W - sw - 16 - 36, 150))
out = os.path.join(here, 'img', 'og.png')
img.save(out, optimize=True)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
