import base64, sys, pathlib

root = pathlib.Path(__file__).resolve().parents[2]
logos = root / 'assets/logos'
h = (root / 'scripts/pitch/deck.src.html').read_text()

for f in logos.glob('*.png'):
    h = h.replace('{{' + f.stem + '}}', 'data:image/png;base64,' + base64.b64encode(f.read_bytes()).decode())

svg = (logos / 'solana.svg').read_text().replace(
    '<path',
    '<defs><linearGradient id="sg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/>'
    '<stop offset="1" stop-color="#14F195"/></linearGradient></defs><path fill="url(#sg)"', 1)
h = h.replace('{{solana_svg}}', svg)

assert '{{' not in h, h[h.index('{{'):h.index('{{') + 40]
(root / sys.argv[1]).write_text(h)
