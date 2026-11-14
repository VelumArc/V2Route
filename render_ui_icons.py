"""Downsample the approved tightly framed toolbar PNG. Requires Pillow."""
from pathlib import Path
import json
from PIL import Image
ROOT=Path(__file__).resolve().parent
SIZES=(16,20,24,32,40,48,64,128,256)
def main():
    source=ROOT/'chrome-extension/v2route-ui/icons/brand-toolbar.png'
    with Image.open(source) as image:
        image=image.convert('RGBA')
        assert image.width==image.height
        for browser in ('chrome','firefox'):
            icons=ROOT/f'{browser}-extension/v2route-ui/icons'
            for size in SIZES:
                image.convert('RGBa').resize((size,size),Image.Resampling.LANCZOS).convert('RGBA').save(icons/f'icon-{size}.png',optimize=True)
            for size in (72,144,216):
                image.convert('RGBa').resize((size,size),Image.Resampling.LANCZOS).convert('RGBA').save(icons/f'brand-display-{size}.png',optimize=True)
    print(json.dumps({'ok':True,'sizes':SIZES,'source':str(source)}))
if __name__=='__main__':main()
