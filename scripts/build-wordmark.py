"""Regenerate Safe Home outlined SVGs from the existing OFL Hanken font.

Authoring only: install fonttools[woff] in a temporary Python environment.
Run from the repo root. CI ships the committed SVGs, with no Python dependency.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = Path('node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2')
OUT = Path('ui/kit/brand')

def lettering(text, weight, x, baseline, size):
    font = instantiateVariableFont(TTFont(FONT), {'wght': weight}, inplace=True)
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    paths = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        paths.append(pen.getCommands())
        x += glyphs[name].width * scale + .25
    return ''.join(paths)

# A house and an open doorway, not State Farm's three-oval emblem.
HOUSE = 'M6 25 28 6l22 19M12 21v28h32V21M23 49V32h10v17'
TEXT = lettering('SAFE', 800, 65, 26, 29) + lettering('HOME', 450, 65, 50, 29)
for theme, ink, red in [('light', '#403c3c', '#d62311'), ('dark', '#f5f4f4', '#ff9187')]:
    mark = f'<g fill="none" stroke="{red}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="{HOUSE}"/></g>'
    (OUT / f'homebeacon-wordmark-on{theme}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 56" width="176" height="56" role="img" aria-label="Safe Home"><title>Safe Home</title>{mark}<path fill="{ink}" d="{TEXT}"/></svg>\n')
    (OUT / f'homebeacon-mark-on{theme}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" width="56" height="56" role="img" aria-label="Safe Home"><title>Safe Home</title>{mark}</svg>\n')
Path('public/favicon.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" rx="12" fill="#d62311"/><g transform="translate(5 4) scale(.82)" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="{HOUSE}"/></g></svg>\n')
