#!/usr/bin/env python3
"""Design-review boards from real Checkpoint browser captures; no database access."""
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import cairosvg, math, textwrap

ROOT=Path(__file__).resolve().parents[2]
SRC=ROOT/"portfolio-captures"
OUT=SRC/"boards"
OUT.mkdir(exist_ok=True,parents=True)
BRAND=ROOT/"frontend/public/brand/logo"
COL={"blue":"#4166B0","sky":"#6296CF","mint":"#63C3A6","dark":"#101827","ink":"#231F20","paper":"#F7F9FB","soft":"#DFE8F1"}
FT="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FB="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
def font(sz,bold=False):return ImageFont.truetype(FB if bold else FT,sz)
def drawtext(d,xy,string,sz=28,color="#17243D",bold=False,maxw=760,gap=12):
  x,y=xy;line=""
  for word in str(string).split():
    proposed=(line+" "+word).strip()
    if line and d.textbbox((0,0),proposed,font=font(sz,bold))[2]>maxw:
      d.text((x,y),line,fill=color,font=font(sz,bold));y+=sz+gap;line=word
    else:line=proposed
  if line:d.text((x,y),line,fill=color,font=font(sz,bold))
  return y+sz
def new(dark=False):
  image=Image.new("RGB",(1600,1080),COL["dark"] if dark else COL["paper"])
  return image,ImageDraw.Draw(image)
def logo(img,x,y,w=480,dark=False):
  file=BRAND/("checkpoint-logo-dark.svg" if dark else "checkpoint-logo.svg")
  png=cairosvg.svg2png(url=str(file),output_width=w)
  layer=Image.open(BytesIO(png)).convert("RGBA")
  img.paste(layer,(x,y),layer)
def sample(img,name,box):
  source=SRC/(name+".png")
  if not source.exists():raise FileNotFoundError(source)
  layer=Image.open(source).convert("RGB")
  x,y,w,h=box
  # Contain full UI; use clean letterboxing to avoid falsifying interface elements.
  layer.thumbnail((w-20,h-20),Image.Resampling.LANCZOS)
  d=ImageDraw.Draw(img)
  d.rounded_rectangle((x-7,y-7,x+w+7,y+h+7),radius=22,fill="#C5D6E5")
  d.rounded_rectangle((x,y,x+w,y+h),radius=15,fill="#FFFFFF")
  img.paste(layer,(x+(w-layer.width)//2,y+(h-layer.height)//2))
def tag(d,x,y,text,dark=False):
  fill="#243951" if dark else "#E2F3ED"
  ink="#DDFBF0" if dark else "#1F7460"
  f=font(18,True);w=d.textbbox((0,0),text,font=f)[2]+44
  d.rounded_rectangle((x,y,x+w,y+48),radius=18,fill=fill)
  d.text((x+22,y+11),text,fill=ink,font=f);return x+w+14
def save(img,name):img.save(OUT/name,quality=91,optimize=True,progressive=True)

# Cover variant — composed from the actual Checkpoint admin UI, following
# the approved blue-to-cyan browser-window reference rather than synthetic UI.
cover=Image.new("RGB",(1600,1080))
pix=cover.load()
for y in range(1080):
  for x in range(1600):
    u=x/1600; v=y/1080
    gl=min(1,max(0,0.18+0.9*u-0.18*v))
    left=(35,74,167); right=(32,213,224)
    pix[x,y]=tuple(round(left[k]*(1-gl)+right[k]*gl) for k in range(3))
shadow=Image.new("RGBA",cover.size,(0,0,0,0))
ImageDraw.Draw(shadow).rounded_rectangle((143,198,1457,938),radius=34,fill=(12,25,54,120))
shadow=shadow.filter(ImageFilter.GaussianBlur(29))
cover=Image.alpha_composite(cover.convert("RGBA"),shadow).convert("RGB")
sample(cover,"05-admin-dashboard",(150,192,1300,710))
save(cover,"00-checkpoint-cover-gradient.jpg")

# Board 1 — flagship cover
im,d=new(True)
d.ellipse((850,-280,1870,820),fill="#1F3B54")
d.ellipse((1120,-200,1740,500),fill="#2C665C")
logo(im,90,58,465,True)
drawtext(d,(91,245),"FINANCE.  TRUST.  PROGRESS.",21,"#98CEC4",True)
drawtext(d,(88,355),"A clearer way to grow together.",77,"#FFFFFF",True,690,5)
drawtext(d,(90,648),"Group contributions, loans, savings and member equity — one accountable workspace.",28,"#BCD4E3",False,630)
sample(im,"02-product-demo",(780,230,760,655))
tag(d,89,897,"FINANCIAL PRODUCT  /  2026",True)
d.text((91,1000),"CHECKPOINT  •  DESIGN CASE STUDY  •  DEMONSTRATION DATA",fill="#B9D0DC",font=font(17))
save(im,"01-checkpoint-cover.jpg")

# Board 2 — identity
im,d=new()
drawtext(d,(86,70),"02 / DESIGN LANGUAGE",22,"#4C807C",True)
drawtext(d,(84,158),"Clarity that builds confidence.",65,COL["dark"],True,1260)
logo(im,100,340,760)
drawtext(d,(100,610),"Official identity from the Checkpoint application repository.",24,"#465A6D")
palette=[("Deep blue","#4166B0"),("Soft blue","#6296CF"),("Mint","#63C3A6"),("Ink","#231F20")]
for i,(name,hexv) in enumerate(palette):
  x=95+350*i
  d.rounded_rectangle((x,725,x+298,925),radius=18,fill=hexv)
  d.text((x,945),name+"  "+hexv,fill=COL["ink"],font=font(19,True))
save(im,"02-checkpoint-brand.jpg")

# Board 3 — authentic admin UI
im,d=new()
drawtext(d,(86,60),"03 / GROUP FINANCIAL OVERVIEW",21,"#4C807C",True)
drawtext(d,(84,124),"One view of the group's position.",60,COL["dark"],True,1400)
drawtext(d,(87,244),"A connected overview of equity, cash, outstanding loans and contributions.",25,"#53687A")
sample(im,"05-admin-dashboard",(77,341,1445,625))
tag(d,85,1000,"ACTUAL APPLICATION UI  •  FICTIONAL RECORDS")
save(im,"03-overview-showcase.jpg")

# Board 4 — contribution and lending records
im,d=new(True)
drawtext(d,(88,65),"04 / EVERYDAY FINANCIAL WORKFLOWS",21,"#98CEC4",True)
drawtext(d,(86,125),"Contributions meet accountability.",55,"#FFFFFF",True,1420)
drawtext(d,(88,226),"Track member payments, loan balances and repayment activity with structured records.",25,"#BBD4E1")
sample(im,"06-contribution-tracking",(75,358,714,547))
sample(im,"07-loan-register",(814,358,714,547))
tag(d,86,963,"MEMBER CONTRIBUTIONS",True)
tag(d,430,963,"LOAN REGISTER",True)
save(im,"04-contributions-and-loans.jpg")

# Board 5 — responsive experience
im,d=new()
drawtext(d,(82,74),"05 / MEMBER EXPERIENCE",21,"#4C807C",True)
drawtext(d,(84,144),"Every member deserves a clear view.",62,COL["dark"],True,1330)
drawtext(d,(87,268),"Personal contributions, borrowing position and group transparency — designed for everyday access.",25,"#53687A",False,1180)
sample(im,"04-sign-in",(80,373,865,555))
sample(im,"08-member-mobile",(1100,318,345,667))
tag(d,87,1000,"RESPONSIVE UI  •  MOCK MEMBERS")
save(im,"05-member-experience.jpg")

# Board 6 — closing
im,d=new(True)
logo(im,90,50,465,True)
drawtext(d,(87,270),"Less paperwork. More confidence.",77,"#FFFFFF",True,1320)
drawtext(d,(90,530),"Built for groups that save, lend and invest together.",35,"#A5DBCB",False,1100)
for i,(label,subtitle) in enumerate([
  ("CONTRIBUTIONS","Record and review member payments"),
  ("LOANS","Understand outstanding balances"),
  ("MEMBER EQUITY","Make group finances easier to follow")
]):
  y=708+i*108
  d.rounded_rectangle((83,y,1511,y+90),radius=16,fill="#1D3141")
  d.text((117,y+21),label,fill="#E8FFF6",font=font(25,True))
  d.text((645,y+25),subtitle,fill="#BDD1DB",font=font(20))
save(im,"06-checkpoint-closing.jpg")
print("Generated",len(list(OUT.glob("*.jpg"))),"real-brand portfolio boards")
