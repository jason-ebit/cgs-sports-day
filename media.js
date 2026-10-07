import { TEAM_IDS, COLOURS } from './model.js?v=25';
import { iconData } from './icons.js?v=25';
import { EVENT_ICONS, orderedSchedule } from './content.js?v=25';

export function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export async function renderMedia({state,schedule,size}) {
  await Promise.all([document.fonts.load('400 20px Poppins'),document.fonts.load('700 20px Poppins'),document.fonts.load('900 100px Poppins')]);
  const images={};await Promise.all([...new Set([...EVENT_ICONS,'calendar','pin','clock'])].map(async name=>{const img=new Image();img.src=iconData(name);await img.decode();images[name]=img;}));
  const canvas=document.createElement('canvas');canvas.width=size==='phone'?1080:1536;canvas.height=size==='phone'?1920:1610;
  const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);
  const box=(x,y,w,h,fill='#fafbfc',stroke='#dde0e3',r=13)=>{c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1.8;c.stroke();}};
  const text=(s,x,y,font=20,weight=400,color='#111',align='left',maxWidth)=>{c.font=`${weight} ${font}px Poppins, Arial, sans-serif`;c.fillStyle=color;c.textAlign=align;c.textBaseline='middle';if(maxWidth)while(c.measureText(s).width>maxWidth&&font>8){font-=.5;c.font=`${weight} ${font}px Poppins, Arial, sans-serif`;}c.fillText(s,x,y);};
  const line=(x,y,x2,y2,color='#d8dce0',width=1.5)=>{c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();};
  const icon=(name,x,y,n)=>c.drawImage(images[name],x,y,n,n);
  const circle=(id,x,y,r)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=COLOURS[TEAM_IDS.indexOf(id)];c.fill();if(id==='white'){c.strokeStyle='#222';c.lineWidth=1.5;c.stroke();}};
  const label=id=>state.teams.find(t=>t.id===id)?.name||'—';
  const teamRow=(x,y,w,r=16,order=TEAM_IDS,font=16)=>order.forEach((id,i)=>{const cx=x+w*(i+.5)/5;circle(id,cx,y,r);text(label(id),cx,y+r+22,font,400,'#202326','center',w/5-8);});
  const badge=(n,x,y,r=20)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle='#343638';c.fill();text(String(n),x,y+1,r*1.08,400,'#fff','center');};
  const gameHead=(n,name,ic,x,y,w,font=25)=>{badge(n,x+20,y+21);icon(ic,x+64,y-1,44);text(name,x+126,y+22,font,700,'#111','left',w-137);};
  const footer=(y,w)=>{line(30,y,w-30,y,'#74787c',2);text('O C T  2 5 T H  ·  C G  S P O R T S  D A Y',w-34,y+36,15,400,'#222','right');};
  const dateCard=(x,y,w,h)=>{box(x,y,w,h,'#fff','#c6c9cd',20);icon('calendar',x+28,y+30,44);text('OCT 25',x+105,y+45,38,700);text('11:40 – 16:00',x+105,y+88,25);line(x+25,y+113,x+w-25,y+113,'#404345',2);icon('pin',x+31,y+129,40);text('대현산배수지공원',x+w-30,y+154,23,700,'#111','right',w-100);};
  const rundown=(x,y,w,h,phone=false)=>{
    box(x,y,w,h);icon('clock',x+22,y+25,phone?46:60);text('RUNDOWN',x+(phone?87:106),y+(phone?48:55),phone?43:53,900);
    const top=y+(phone?93:110),gap=Math.min(phone?55:69,(h-(phone?93:110)-24)/schedule.length), timeW=phone?201:182, ix=x+timeW+45, nameX=ix+(phone?74:106);
    orderedSchedule(schedule).forEach((e,i)=>{
      const ry=top+i*gap,high=e.highlight,colors={yellow:['#ffda8b','#fff5df'],green:['#b5e9af','#dff4dd'],pink:['#ffb9bd','#ffe4e7']};
      if(high)box(ix-3,ry,w-timeW-63,gap-7,colors[high][1],null,12);
      box(x+20,ry,timeW,gap-9,high?colors[high][0]:'#303132',null,10);
      text(e.start+(e.durationMinutes?' – '+e.end:''),x+20+timeW/2,ry+(gap-9)/2,phone?21:22,high?700:400,high?'#111':'#fff','center',timeW-8);
      if(!high)box(ix,ry,phone?57:80,gap-9,'#e9ebec',null,25);icon(EVENT_ICONS[e.eventIndex],ix+(phone?10:18),ry+(phone?6:8),phone?36:43);
      text(e.title,nameX,ry+(gap-9)/2,phone?24:25,high?700:400,'#111','left',x+w-nameX-18);
      if(!high)line(nameX-2,ry+gap-4,x+w-22,ry+gap-4,'#e0e3e5');
    });
  };
  if(size==='poster') {
    text('SPORTS DAY',42,110,119,900,'#050505','left',1000);text('O C T  2 5 T H  ·  R U N D O W N  &  G A M E  F O R M A T S',54,195,19);
    dateCard(1159,42,337,184);rundown(28,263,698,1195);
    box(745,263,763,193);text('TEAM COLOURS',777,308,31,700);teamRow(758,374,731,25,TEAM_IDS,20);
    const x=744,w=365,x2=1125,w2=383,y=475,h=314,y2=807;
    const card=(cx,cy,cw,ch,n,name,ic,kicker)=>{box(cx,cy,cw,ch);gameHead(n,name,ic,cx+13,cy+13,cw-22);text(kicker,cx+cw/2,cy+99,17,700,'#6b7076','center',cw-24);};
    const bottom=(cx,cy,cw,copy)=>{box(cx+22,cy,cw-44,41,'#edeff1',null,10);text(copy,cx+cw/2,cy+21,19,400,'#17191b','center',cw-55);};
    card(x,y,w,h,1,'Borrow-a-Thing','borrow','ALL FIVE TEAMS TOGETHER');teamRow(x+15,y+146,w-30,15,TEAM_IDS,15);text('6–7 rounds · cumulative points',x+w/2,y+217,19,400,'#222','center',w-25);bottom(x,y+251,w,'Total points → placing');
    card(x2,y,w2,h,2,'Ball Basket','basket','TEAMS TAKE TURNS');teamRow(x2+15,y+146,w2-30,15,['yellow','white','red','green','blue'],15);text('2 attempts per team',x2+w2/2,y+217,19,400,'#222','center');bottom(x2,y+251,w2,'Best score → placing');
    card(x,y2,w,h,3,'Cavalry Game','cavalry','ALL-IN BATTLE');
    c.beginPath();c.ellipse(x+w/2,y2+165,69,39,0,0,Math.PI*2);c.setLineDash([4,4]);c.strokeStyle='#adb4ba';c.stroke();c.setLineDash([]);
    TEAM_IDS.forEach((id,i)=>{const a=-Math.PI/2+i*2*Math.PI/5;circle(id,x+w/2+69*Math.cos(a),y2+165+39*Math.sin(a),12);});text('ALL TEAMS',x+w/2,y2+166,10,400,'#777','center');text('Same-gender rounds · last horse wins',x+w/2,y2+226,18,400,'#222','center',w-30);bottom(x,y2+251,w,'Elimination order → points');
    card(x2,y2,w2,h,4,'Tug-of-War','tug','DRAWN TOURNAMENT BRACKET');
    const bx=x2+22,by=y2+118;line(bx+92,by+14,bx+108,by+14);line(bx+92,by+47,bx+108,by+47);line(bx+108,by+14,bx+108,by+47);line(bx+108,by+30,bx+122,by+30);line(bx+191,by+30,bx+218,by+30);line(bx+191,by+77,bx+205,by+77);line(bx+205,by+30,bx+205,by+77);line(bx+205,by+53,bx+233,by+53);
    [[0,0,92,state.tug.slots[0]?label(state.tug.slots[0]):'Draw 1'],[0,33,92,state.tug.slots[1]?label(state.tug.slots[1]):'Draw 2'],[122,16,69,'Semi 1'],[122,63,69,'Semi 2'],[233,39,102,state.tug.winners.final?label(state.tug.winners.final):'Final']].forEach(([dx,dy,bw,t])=>{box(bx+dx,by+dy,bw,28,'#fff','#d3d8dc',5);text(t,bx+dx+bw/2,by+dy+14,12,400,'#333','center',bw-6);});text('3 byes',bx+46,by+78,11,400,'#71767b','center');text('1 preliminary · 2 semis · final',x2+w2/2,y2+226,18,400,'#222','center',w2-30);bottom(x2,y2+251,w2,state.tug.locked?'Draw locked':'Draw opponents → bracket');
    box(x,1140,764,318);gameHead(5,'Team Relay','relay',x+14,1154,358);text('ALL FIVE TEAMS RACE',x+186,1235,17,700,'#6b7076','center');
    TEAM_IDS.forEach((id,i)=>{const yy=1272+i*29;circle(id,x+37,yy,9);text(label(id),x+57,yy,16,400,'#222','left',85);line(x+146,yy,x+331,yy,'#9da4aa');line(x+324,yy-4,x+331,yy,'#9da4aa');line(x+324,yy+4,x+331,yy,'#9da4aa');});bottom(x,1413,365,'3-round points → placing');
    c.setLineDash([5,4]);line(1121,1160,1121,1440,'#bfc5ca');c.setLineDash([]);text('Relay Rounds',1155,1205,23,700);['Baton Relay','Three-Legged Relay','Spoon & Ball Relay'].forEach((r,i)=>{badge(i+1,1184,1262+i*62,21);text(r,1235,1262+i*62,20,400,'#222','left',241);});footer(1507,1536);
  } else {
    text('SPORTS DAY',48,133,121,900,'#050505','left',974);text('O C T  2 5 T H  ·  R U N D O W N  &  G A M E  F O R M A T S',58,226,18);
    box(48,302,984,96,'#fff','#cbd0d4',15);icon('calendar',73,326,43);text('OCT 25',138,337,28,700);text('11:40 – 16:00',138,369,21);line(494,325,494,377,'#cbd0d4');icon('pin',530,326,43);text('대현산배수지공원',604,351,30,700,'#111','left',391);
    rundown(48,424,984,942,true);
    box(48,1387,984,110);text('TEAM COLOURS',73,1418,19,700);TEAM_IDS.forEach((id,i)=>{const cx=94+i*191;circle(id,cx,1461,14);text(label(id),cx+25,1462,18,400,'#222','left',145);});
    text('GAME FORMATS',59,1538,27,700);
    const copy=[['borrow','Borrow-a-Thing','All teams · 6–7 rounds · total points'],['basket','Ball Basket','Take turns · 2 attempts · best count'],['cavalry','Cavalry Game','All-in battle · elimination order → points'],['tug','Tug-of-War','Drawn bracket · preliminary → semis → final'],['relay','Team Relay','All teams · baton / three-legged / spoon & ball']];
    copy.forEach(([ic,name,desc],i)=>{const yy=1579+i*49;badge(i+1,73,yy+7,15);icon(ic,103,yy-10,32);text(name,151,yy+6,21,700,'#111','left',270);text(desc,433,yy+6,19,400,'#656b71','left',572);});footer(1851,1080);
  }
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`CG Sports Day ${size==='phone'?'phone story':'full poster'} export preview`);
  return canvas;
}
