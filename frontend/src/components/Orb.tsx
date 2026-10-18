import { useEffect, useRef } from "react";

// El núcleo de Jarvis: una esfera de plasma dibujada con WebGL que cambia según su estado.
//   idle      respira despacio
//   listening se agita con tu voz (level: volumen del micro, 0–1)
//   thinking  remolino rápido y más brillante
//   speaking  late al ritmo de la voz
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

const TARGET: Record<OrbState, { energy: number; speed: number; hue: number }> = {
  idle: { energy: 0.18, speed: 0.12, hue: 0 },
  listening: { energy: 0.45, speed: 0.28, hue: 0.35 },
  thinking: { energy: 0.8, speed: 0.75, hue: 1 },
  speaking: { energy: 0.55, speed: 0.35, hue: 0.15 },
};

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

// Ruido simplex 3D (Ashima Arts, MIT) + fbm.
const FRAG = `precision highp float;
uniform vec2 res; uniform float t; uniform float energy; uniform float hue;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){ float a=.5, f=0.; for(int i=0;i<4;i++){ f+=a*snoise(p); p*=2.02; a*=.5; } return f; }
void main(){
  vec2 uv=(gl_FragCoord.xy*2.-res)/min(res.x,res.y);
  float r=length(uv);
  float n=fbm(vec3(uv*1.4, t*.6));
  float R=.62+.035*energy+.02*sin(t*1.7);
  float edge=R+.07*n*(.5+energy);
  float inside=smoothstep(edge+.012,edge-.012,r);
  float p=fbm(vec3(uv*2.3+vec2(n*.9), t*.9));
  float swirl=fbm(vec3(uv*3.6-vec2(p), t*1.4));
  vec3 blue=vec3(.33,.56,1.), violet=vec3(.58,.40,.98), cyan=vec3(.20,.86,.95), white=vec3(.92,.95,1.);
  vec3 col=mix(blue,violet,smoothstep(-.35,.55,p+hue*.25));
  col=mix(col,cyan,smoothstep(.25,.85,swirl+uv.y*.25)*(.6+.4*(1.-hue)));
  float core=exp(-r*r*3.)*(.45+.7*energy);
  float depth=smoothstep(edge,0.,r);
  vec3 body=col*(.55+1.1*max(p,0.)+.7*max(swirl,0.))*(.6+.5*depth)+white*core*.9+violet*.12;
  float rim=pow(smoothstep(edge-.22,edge,r),2.)*inside;
  vec3 color=body*inside+mix(col,white,.35)*rim*1.2;
  float glow=exp(-max(r-edge,0.)*(7.-3.*energy))*(.28+.55*energy)*(1.-inside);
  color+=col*glow;
  float a=clamp(inside+glow,0.,1.);
  gl_FragColor=vec4(color*a,a);
}`;

export default function Orb({ state, level, size = 240 }: { state: OrbState; level?: React.RefObject<number>; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const gl = el.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) {
      el.dataset.fallback = "1";
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(
        "Orb: no se pudo compilar el shader",
        gl.getProgramInfoLog(prog),
        ...(gl.getAttachedShaders(prog) ?? []).map((sh) => gl.getShaderInfoLog(sh)),
      );
      el.dataset.fallback = "1";
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = u("res"),
      uT = u("t"),
      uEnergy = u("energy"),
      uHue = u("hue");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let clock = 0;
    const cur = { ...TARGET.idle };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = TARGET[stateRef.current];
      const voice = level?.current ?? 0;
      const extra = stateRef.current === "listening" ? voice * 0.8 : stateRef.current === "speaking" ? 0.15 + 0.15 * Math.sin(now / 90) : 0;
      // Las transiciones entre estados son suaves (nunca saltos).
      const k = 1 - Math.exp(-dt * 4);
      cur.energy += (target.energy + extra - cur.energy) * k;
      cur.speed += (target.speed - cur.speed) * k;
      cur.hue += (target.hue - cur.hue) * k;
      clock += dt * (reduced ? 0.15 : cur.speed + extra * 0.6);

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(el.clientWidth * dpr);
      const h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uT, clock);
      gl.uniform1f(uEnergy, cur.energy);
      gl.uniform1f(uHue, cur.hue);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // No se suelta el contexto: el lienzo es el mismo si React vuelve a montar el efecto.
    return () => cancelAnimationFrame(raf);
  }, [level]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Respaldo sin WebGL: un degradado que respira */}
      <div
        aria-hidden
        className="absolute inset-[18%] animate-pulse rounded-full opacity-70 blur-xl"
        style={{ background: "radial-gradient(circle at 40% 35%, #a9c3ff, #7aa7ff 35%, #8b5cf6 70%, transparent 72%)" }}
      />
      <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />
    </div>
  );
}
