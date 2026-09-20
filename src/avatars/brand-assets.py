"""Render the existing pet navigation mark into bundled Android brand assets."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / "assets" / "brand"
OUT.mkdir(parents=True, exist_ok=True)

def curve(a, b, c, d, count=40):
    return [tuple((1-t)**3*a[i]+3*(1-t)**2*t*b[i]+3*(1-t)*t*t*c[i]+t**3*d[i] for i in (0,1)) for t in [x/count for x in range(count+1)]]

def render(name, background, ink, mark_size):
    scale=3
    image=Image.new("RGBA", (1024*scale,1024*scale),background)
    draw=ImageDraw.Draw(image)
    def point(pair): return tuple(round((512+(v-12)*mark_size/24)*scale) for v in pair)
    line=[(5,11),(3,4),(9,7)]+curve((9,7),(11,6.45),(13,6.45),(15,7))+[(21,4),(19,11),(19,16)]+curve((19,16),(19,20),(5,20),(5,16))+[(5,11)]
    width=round(mark_size/24*1.65*scale)
    draw.line([point(p) for p in line],fill=ink,width=width,joint="curve")
    for p in line:
        x,y=point(p); r=width/2
        draw.ellipse((x-r,y-r,x+r,y+r),fill=ink)
    for x in (9,15):
        draw.line([point((x,12)),point((x,13))],fill=ink,width=width)
    draw.line([point(p) for p in curve((10,16),(11.2,17.3),(12.8,17.3),(14,16))],fill=ink,width=width,joint="curve")
    image.resize((1024,1024),Image.Resampling.LANCZOS).save(OUT/name)

render("icon.png", "#FAFAFA", "#245C4A", 650)
render("adaptive-foreground.png", (0,0,0,0), "#245C4A", 490)
render("splash-light.png", (0,0,0,0), "#245C4A", 650)
render("splash-dark.png", (0,0,0,0), "#B6D5C7", 650)
print("Rendered 4 bundled pet-mark assets; source matches src/ui/Icon.tsx pet mark.")
