/* Advanced, deterministic browser effect compositor.
 * These effects are intentionally dependency-free: the editor preview and
 * client-side export can execute the same code. Each effect is a layer, so
 * effects can be stacked and composited with different blend modes.
 */
import type { EffectBlendMode, VideoEffectLayer, EffectType } from '@/lib/video/project';

type Ctx = CanvasRenderingContext2D;

function clamp(v:number, lo=0, hi=1){return Math.max(lo,Math.min(hi,v));}
function hash(n:number){const x=Math.sin(n*12.9898+78.233)*43758.5453;return x-Math.floor(x);}
function blend(ctx:Ctx, mode:EffectBlendMode|undefined){ctx.globalCompositeOperation=(mode||'normal') as GlobalCompositeOperation;}
function rgba(hex:string,a:number){
  const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16)||255,g=parseInt(h.slice(2,4),16)||255,b=parseInt(h.slice(4,6),16)||255;
  return `rgba(${r},${g},${b},${clamp(a)})`;
}

/* Never draw a canvas back onto itself. Browser canvas implementations are
   allowed to produce feedback/undefined pixels for self-blits, which showed
   up as flashes/black frames in blur and kaleidoscope previews. */
function snapshotCanvas(ctx:Ctx,W:number,H:number): HTMLCanvasElement | null {
  const copy=document.createElement('canvas');
  copy.width=W; copy.height=H;
  const c=copy.getContext('2d');
  if(!c) return null;
  c.drawImage(ctx.canvas,0,0,W,H);
  return copy;
}

export function drawAdvancedEffectLayer(
  ctx: Ctx,
  layer: VideoEffectLayer,
  time: number,
  W: number,
  H: number,
  index = 0,
){
  const type: EffectType = layer.type;
  const i=clamp(layer.intensity);
  if(!i || type==='none') return;
  const p=layer.params||{};
  const speed=Math.max(0.05,Number(p.speed)||1);
  const amount=Math.max(0.05,Number(p.amount)||1);
  const size=Math.max(0.1,Number(p.size)||1);
  const softness=clamp(Number(p.softness ?? .5));
  const seed=Number(p.seed)||index+17;
  const t=time*speed;
  ctx.save();
  blend(ctx,layer.blendMode);

  if(type==='prism'){
    ctx.globalAlpha=.20*i;
    const shift=(Math.sin(t*1.7+seed)*W*.035*size);
    ctx.globalCompositeOperation='screen';
    ctx.fillStyle=rgba('#ff315f',.55);ctx.fillRect(shift,0,W,H);
    ctx.fillStyle=rgba('#32d7ff',.42);ctx.fillRect(-shift,0,W,H);
    const g=ctx.createLinearGradient(0,0,W,H);
    g.addColorStop(0,rgba('#fff',.18));g.addColorStop(.5,'rgba(255,120,220,.03)');g.addColorStop(1,rgba('#5de6ff',.16));
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  } else if(type==='lens-flare'){
    ctx.globalCompositeOperation='screen';
    const x=W*(.5+.42*Math.sin(t*.55+seed)), y=H*(.5+.12*Math.cos(t*.7+seed));
    const r=Math.max(W,H)*(.11+.03*Math.sin(t));
    const g=ctx.createRadialGradient(x,y,0,x,y,r);
    g.addColorStop(0,rgba('#fff',.75*i));g.addColorStop(.16,rgba(p.colorA||'#ffd7a0',.34*i));g.addColorStop(1,'rgba(255,100,40,0)');
    ctx.globalAlpha=1;ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=.35*i;ctx.fillStyle='#fff';ctx.fillRect(0,y-1.5*size,W,3*size);
    ctx.globalAlpha=.18*i;ctx.fillStyle='#ffb36b';ctx.fillRect(0,y-7*size,W,14*size);
  } else if(type==='light-rays'){
    ctx.globalCompositeOperation='screen';
    ctx.globalAlpha=.10*i;
    const cx=W*(.5+.22*Math.sin(t*.25)),cy=H*(.12+.08*Math.cos(t*.33));
    for(let k=0;k<14;k++){
      const spread=(k-7)*(.09+softness*.04);
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(W*(.5+spread),H);ctx.lineTo(W*(.58+spread),H);ctx.closePath();
      ctx.fillStyle=k%2?rgba(p.colorA||'#ffdba5',.35):rgba(p.colorB||'#a8d8ff',.22);ctx.fill();
    }
  } else if(type==='bokeh'){
    ctx.globalCompositeOperation='screen';
    const count=Math.round(16+18*i*size);
    for(let n=0;n<count;n++){
      const q=hash(n+seed*31),q2=hash(n*7.31+seed*11);
      const x=((q+t*.025*(n%2?1:-1))%1)*W,y=((q2+t*.018*(n%3?1:-1))%1)*H;
      const r=(2+hash(n*3.7+seed)*Math.min(W,H)*.035)*size;
      const g=ctx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,rgba(p.colorA||'#fff4cf',.34*i));g.addColorStop(.55,rgba(p.colorB||'#ff9acb',.10*i));g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
  } else if(type==='dust'||type==='scratches'){
    ctx.globalAlpha=(type==='dust'?.16:.10)*i;
    const count=type==='dust'?70:18;
    for(let n=0;n<count;n++){
      const x=hash(n+seed*4.1)*W,y=((hash(n*2.7+seed*8)+t*.015)%1)*H;
      if(type==='dust'){ctx.fillStyle=n%3?'#fff':'#222';ctx.fillRect(x,y,Math.max(1,W/900)*size,Math.max(1,H/900)*size);}
      else {ctx.strokeStyle=n%2?'#fff':'#222';ctx.lineWidth=Math.max(1,W/1200)*size;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.sin(n+seed)*W*.012,y+H*(.08+hash(n)*.16));ctx.stroke();}
    }
  } else if(type==='tape-warp'){
    ctx.globalAlpha=.11*i;
    const bandH=Math.max(3,H*.025*size);
    for(let n=0;n<7;n++){const y=((hash(n+seed)*H+t*H*.12)%H);const dx=Math.sin(t*15+n*4.7)*W*.035*i;
      ctx.fillStyle=n%2?'#fff':'#0ff';ctx.fillRect(dx,y,W,bandH);}
  } else if(type==='chromatic-aberration'){
    ctx.globalCompositeOperation='screen';ctx.globalAlpha=.12*i;
    const s=W*.009*size*Math.sin(t*1.8);
    ctx.fillStyle='#ff174f';ctx.fillRect(s,0,W,H);ctx.fillStyle='#00eaff';ctx.fillRect(-s,0,W,H);
  } else if(type==='displacement'){
    ctx.globalAlpha=.10*i;
    const bandH=Math.max(2,H/28);
    for(let n=0;n<28;n++){const y=n*bandH;const dx=Math.sin(t*2.3+n*.71)*W*.025*i;
      ctx.fillStyle=n%2?'rgba(255,255,255,.18)':'rgba(0,0,0,.12)';ctx.fillRect(dx,y,W,bandH*.65);}
  } else if(type==='glitch-blocks'){
    ctx.globalAlpha=.18*i;
    const count=Math.round(5+10*i);
    for(let n=0;n<count;n++){const y=hash(n+seed)*H,w=W*(.04+hash(n*2+seed)*.22),h=H*(.006+hash(n*4+seed)*.035),x=hash(n*8+seed)*W;
      ctx.fillStyle=n%2?'rgba(255,0,100,.55)':'rgba(0,220,255,.55)';ctx.fillRect(x+Math.sin(t*30+n)*W*.02,y,w,h);}
  } else if(type==='edge-glow'){
    ctx.globalCompositeOperation='screen';ctx.globalAlpha=.13*i;
    const step=Math.max(8,W/75);
    ctx.strokeStyle=p.colorA||'#8ff';ctx.lineWidth=Math.max(1,W/500)*size;
    for(let x=0;x<W;x+=step){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+Math.sin(t+x*.02)*4,H);ctx.stroke();}
  } else if(type==='radial-blur'){
    ctx.globalAlpha=.06*i;
    const cx=W/2,cy=H/2;
    const source=snapshotCanvas(ctx,W,H);
    if(source) for(let n=1;n<=5;n++){const s=1+n*.012*i*amount;ctx.drawImage(source,0,0,W,H,cx-(W*s)/2,cy-(H*s)/2,W*s,H*s);}
  } else if(type==='tilt-shift'){
    const band=H*(.22+.12*(1-softness));const g=ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'rgba(255,255,255,.08)');g.addColorStop(.5-.12,'rgba(0,0,0,0)');g.addColorStop(.5+.12,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,.10)');
    ctx.globalAlpha=.55*i;ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    void band;
  } else if(type==='film-gate'){
    ctx.globalAlpha=.12*i;
    const weaveX=Math.sin(t*7.1)*W*.006*size,weaveY=Math.cos(t*6.3)*H*.004*size;
    ctx.fillStyle='rgba(255,245,220,.35)';ctx.fillRect(weaveX,weaveY,W,H*.012);
    ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(-weaveX,H*.985+weaveY,W,H*.015);
    if(Math.sin(t*18)>0.93){ctx.fillStyle='rgba(255,255,255,.18)';ctx.fillRect(0,0,W,H);}
  } else if(type==='colorize'){
    ctx.globalCompositeOperation='soft-light';ctx.globalAlpha=.30*i;
    const g=ctx.createLinearGradient(0,0,W,H);g.addColorStop(0,p.colorA||'#1e90ff');g.addColorStop(1,p.colorB||'#ff6b9d');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  } else if(type==='kaleidoscope'){
    ctx.globalCompositeOperation='screen';ctx.globalAlpha=.10*i;
    const slices=6;const cx=W/2,cy=H/2;
    const source=snapshotCanvas(ctx,W,H);
    if(source){
      ctx.translate(cx,cy);
      for(let n=0;n<slices;n++){ctx.save();ctx.rotate((Math.PI*2*n)/slices+t*.12);if(n%2)ctx.scale(-1,1);ctx.drawImage(source,-cx,-cy,W,H);ctx.restore();}
    }
  }
  ctx.restore();
}

export function drawAdvancedEffectStack(ctx:Ctx,layers:VideoEffectLayer[],time:number,W:number,H:number){
  layers.forEach((layer,index)=>drawAdvancedEffectLayer(ctx,layer,time,W,H,index));
}
