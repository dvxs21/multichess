import { Chess } from 'chess.js';
// Emits verified puzzles as JSON lines: {k:"m1"|"m2", fen, sol:[lan...]}
// m1: exactly one mating move. m2: no mate-in-1, exactly one key move forcing mate vs every reply.
const seed=+process.argv[2]||1, M2EVERY=+process.argv[3]||1;
let rng=seed;const rand=n=>{rng=(rng*1103515245+12345)%2147483648;return rng%n;};
const isMate=(c,m)=>{c.move(m);const r=c.isCheckmate();c.undo();return r;};
const mates=c=>c.moves({verbose:true}).filter(m=>isMate(c,m));
const hasMate=c=>c.moves({verbose:true}).some(m=>/[+#]/.test(m.san)&&isMate(c,m));
const seen=new Set();
for(;;){
  const c=new Chess();
  for(let ply=0;ply<140&&!c.isGameOver();ply++){
    const ms=c.moves({verbose:true});
    const agg=ms.filter(m=>m.captured||/[+#]/.test(m.san));
    c.move((agg.length&&rand(3)>0)?agg[rand(agg.length)]:ms[rand(ms.length)]);
    if(ply<20||c.inCheck())continue;
    const fen=c.fen(),key=fen.split(' ').slice(0,4).join(' ');
    if(seen.has(key))continue;seen.add(key);
    const n=c.board().flat().filter(Boolean).length;if(n<9)continue;
    const all=c.moves({verbose:true});
    const checks=all.filter(m=>/[+#]/.test(m.san));
    if(checks.some(m=>isMate(c,m))){
      const m1=checks.filter(m=>isMate(c,m));
      if(m1.length===1)console.log(JSON.stringify({k:'m1',fen,sol:[m1[0].lan]}));
      continue;
    }
    if(rand(M2EVERY))continue;
    // cheap prefilter: some check must leave the opponent with <=3 replies
    if(!checks.some(m=>{c.move(m);const r=c.moves().length<=3;c.undo();return r;}))continue;
    const keys=[];
    for(const a of all){
      c.move(a);
      if(!c.isGameOver()){
        let ok=true,worst=null,wc=99;
        for(const r of c.moves({verbose:true})){c.move(r);
          if(!hasMate(c)){ok=false;c.undo();break;}
          const mm=mates(c);if(mm.length<wc){wc=mm.length;worst=[r.lan,mm[0].lan];}c.undo();}
        if(ok)keys.push([a.lan,...worst]);
      }
      c.undo();if(keys.length>1)break;
    }
    if(keys.length===1&&keys[0][0].length===4)console.log(JSON.stringify({k:'m2',fen,sol:keys[0]}));
  }
}
