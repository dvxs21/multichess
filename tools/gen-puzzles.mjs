import { Chess } from 'chess.js';
const mates=(c)=>c.moves({verbose:true}).filter(m=>{c.move(m);const r=c.isCheckmate();c.undo();return r;});
const out={m1:[],m2:[]};const seen=new Set();
let rng=12345;const rand=n=>{rng=(rng*1103515245+12345)%2147483648;return rng%n;};
const val={p:1,n:3,b:3,r:5,q:9,k:0};
for(let g=0;g<6000&&(out.m1.length<60||out.m2.length<40);g++){
  const c=new Chess();
  for(let ply=0;ply<120&&!c.isGameOver();ply++){
    const ms=c.moves({verbose:true});
    // bias: prefer captures and checks
    const caps=ms.filter(m=>m.captured||m.san.includes('+'));
    const m=(caps.length&&rand(3)>0)?caps[rand(caps.length)]:ms[rand(ms.length)];
    c.move(m);
    if(ply<16)continue;
    const fen=c.fen();const key=fen.split(' ').slice(0,2).join(' ');if(seen.has(key))continue;seen.add(key);
    // need material on both sides to look realistic
    const pieces=c.board().flat().filter(Boolean);if(pieces.length<10)continue;
    const all=c.moves({verbose:true});
    const m1=mates(c);
    if(m1.length===1&&out.m1.length<60&&!c.inCheck()){out.m1.push({fen,sol:[m1[0].lan]});continue;}
    if(m1.length===0&&out.m2.length<40&&!c.inCheck()){
      const keys=[];
      for(const a of all){c.move(a);
        if(!c.isGameOver()){const reps=c.moves({verbose:true});let ok=true,worst=null,wc=99;
          for(const r of reps){c.move(r);const mm=mates(c);c.undo();if(!mm.length){ok=false;break;}if(mm.length<wc){wc=mm.length;worst=[r.lan,mm[0].lan];}}
          if(ok)keys.push([a.lan,...worst]);}
        c.undo();if(keys.length>1)break;}
      if(keys.length===1&&!keys[0][0].includes('=')){out.m2.push({fen,sol:keys[0]});}
    }
  }
}
console.error(out.m1.length,out.m2.length);
console.log(JSON.stringify(out));
