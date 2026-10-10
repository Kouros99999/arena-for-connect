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
d.text((64, 160), 'A fair, live leaderboard', font=font(58), fill='#14191F')
d.text((64, 230), 'for your contact center agents', font=font(58), fill='#0F766E')
d.text((64, 320), 'Points from Connect data, not self-reporting. Coaching, challenges,', font=font(26, False), fill='#3D4650')
d.text((64, 356), 'rewards and a results report. Runs in your own AWS account.', font=font(26, False), fill='#3D4650')
d.rounded_rectangle([64, 420, 420, 480], radius=12, fill='#0F766E')
d.text((88, 435), '$0.75 per active agent-day', font=font(26), fill='#FFFFFF')

shot = Image.open(os.path.join(here, 'img', 'console.webp')).convert('RGB')
sw = 560
sh = int(shot.height * sw / shot.width)
shot = shot.resize((sw, sh), Image.LANCZOS)
frame = Image.new('RGB', (sw + 16, min(sh, 470) + 16), '#E3E7EA')
frame.paste(shot.crop((0, 0, sw, min(sh, 470))), (8, 8))
img.paste(frame, (W - sw - 16 - 40, 150))
out = os.path.join(here, 'img', 'og.png')
img.save(out, optimize=True)
print('wrote', out, os.path.getsize(out) // 1024, 'KB')
