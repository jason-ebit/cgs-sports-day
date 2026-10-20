import { DEPARTMENTS, GAME_NAMES } from './content.js?v=52';
import { TEAM_IDS, COLOURS } from './model.js?v=52';

const escapeHTML=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const e=escapeHTML;
const STATUS_LABELS={playing:'Playing',duty:'On duty',cover:'Cover',unset:'Not set'};
const ASSISTANT_COVER_WARNING='Assistant judge only observes and confirms. Choose an appointed main-judge replacement.';

export const ROTATION_GAMES=Object.freeze([
  {id:'borrow',label:GAME_NAMES.borrow,rounds:Array.from({length:7},(_,i)=>({key:`borrow:${i}`,label:`Round ${i+1}${i===6?' · optional':''}`}))},
  {id:'basket',label:GAME_NAMES.basket,rounds:TEAM_IDS.flatMap(team=>[0,1].map(attempt=>({key:`basket:${team}:${attempt}`,label:`${team[0].toUpperCase()+team.slice(1)} · Try ${attempt+1}`})))},
  {id:'cavalry',label:GAME_NAMES.cavalry,rounds:[{key:'cavalry:women',label:'Women'},{key:'cavalry:men',label:'Men'}]},
  {id:'tug',label:GAME_NAMES.tug,rounds:[{key:'tug:prelim',label:'Preliminary'},{key:'tug:semi1',label:'Semifinal 1'},{key:'tug:semi2',label:'Semifinal 2'},{key:'tug:final',label:'Final'}]},
  {id:'relay',label:GAME_NAMES.relay,rounds:[{key:'relay:0',label:'Baton'},{key:'relay:1',label:'Three-legged'},{key:'relay:2',label:'Spoon & ball'}]},
]);

export function rotationRounds(state,game,round) {
  const rounds=(ROTATION_GAMES.find(item=>item.id===game)||ROTATION_GAMES[0]).rounds;
  if(game==='basket'){
    const team=TEAM_IDS.includes(String(round??'').split(':')[1])?String(round).split(':')[1]:TEAM_IDS[0];
    return rounds.filter(item=>item.key.startsWith(`basket:${team}:`)).map(item=>({...item,label:`Try ${Number(item.key.split(':')[2])+1}`}));
  }
  return game==='borrow'&&state?.borrow?.rounds!==7?rounds.slice(0,6):rounds;
}

export function resolveRotationRound(game,round,state) {
  const rounds=rotationRounds(state,game,round);
  const key=String(round??'').includes(':')?String(round):`${game}:${round??''}`;
  return rounds.some(item=>item.key===key)?key:rounds[0].key;
}

function roster(state) {
  return DEPARTMENTS.flatMap(department=>department.members.map((member,index)=>{
    const raw=String(state.committeeMembers?.[department.id]?.[index]??'').trim();
    return {id:`${department.id}:${index}`,department:department.id,departmentName:department.name,name:raw.toUpperCase()==='TBA'?'':raw,role:member.role,optional:Boolean(member.optional)};
  }));
}

export function renderCommitteeRotation(state,{editable=false,game='borrow',round=null,filter='all'}={}) {
  if(!ROTATION_GAMES.some(item=>item.id===game))game='borrow';
  if(!['all','playing','duty','cover','unset'].includes(filter))filter='all';
  const roundKey=resolveRotationRound(game,round,state),rounds=rotationRounds(state,game,roundKey);
  const roundIndex=rounds.findIndex(item=>item.key===roundKey),previous=rounds[roundIndex-1];
  const basketTeam=game==='basket'?roundKey.split(':')[1]:null;
  const basketTeams=game==='basket'?`<nav class="rota-basket-teams" aria-label="Ball Basket team">${TEAM_IDS.map((id,index)=>`<button type="button" data-rota-basket-team="${id}" class="${basketTeam===id?'selected':''}" aria-pressed="${basketTeam===id}"><span class="dot ${id==='white'?'white':''}" style="--team-color:${COLOURS[index]}" aria-hidden="true"></span><span>${e(state.teams.find(team=>team.id===id)?.name||id)}</span></button>`).join('')}</nav>`:'';
  const assignments=state.committeeRotation?.[roundKey]||{},people=roster(state),named=people.filter(person=>person.name);
  const byId=new Map(people.map(person=>[person.id,person]));
  const coversFor=id=>named.filter(person=>assignments[person.id]?.status==='cover'&&assignments[person.id]?.coverFor===id);
  const counts=Object.fromEntries(Object.keys(STATUS_LABELS).map(status=>[status,named.filter(person=>(assignments[person.id]?.status||'unset')===status).length]));
  const status=person=>assignments[person.id]?.status||'unset';
  const linkNames=(members)=>members.map(person=>person.name).join(', ');
  const uncovered=named.filter(person=>!['warmup','team-leaders'].includes(person.department)&&status(person)==='playing'&&!coversFor(person.id).length);
  const unnamedAssigned=people.filter(person=>!person.name&&assignments[person.id]);
  const hasAssignments=Object.keys(assignments).length>0;
  const hint=editable?'Changes save for everyone. Tap a selected status again to clear it.':'Everyone sees the same rota. Only the scorekeeper can change it.';

  const row=person=>{
    const assignment=assignments[person.id],current=status(person),covering=coversFor(person.id);
    const target=assignment?.coverFor?byId.get(assignment.coverFor):null;
    const duplicate=target?.name&&coversFor(target.id).length>1;
    let detail='';
    if(current==='playing')detail=covering.length?`<p class="rota-relation">${person.department==='first-aid'?`Cover planned: ${e(linkNames(covering))} — confirm trained relief before play.`:person.department==='director'?`Cover planned: ${e(linkNames(covering))} — confirm an appointed neutral replacement before play.`:`Covered by ${e(linkNames(covering))}`}</p>`:['warmup','team-leaders'].includes(person.department)?'':`<p class="rota-relation rota-attention">No cover set${['first-aid','director'].includes(person.department)?' — arrange relief before playing':''}.</p>`;
    if(current==='cover'){
      if(editable&&person.name){
        const options=named.filter(other=>other.id!==person.id);
        detail=`<label class="rota-cover-field"><span>Covering for</span><select data-rota-cover="${e(person.id)}" aria-label="${e(person.name)} — covering for"><option value="">Choose a person</option>${options.map(other=>`<option value="${e(other.id)}" ${target?.id===other.id?'selected':''}>${e(other.name)} · ${e(other.departmentName)}</option>`).join('')}</select></label>${target&&!target.name?`<p class="rota-relation rota-attention">Cover saved for TBA · ${e(target.departmentName)}. Add their name.</p>`:''}`;
      }else detail=`<p class="rota-relation${target?.name?'':' rota-attention'}">${target?`Covering ${e(target.name||'TBA')} · ${e(target.departmentName)}${target.name?'':' — add their name.'}`:'Cover person not chosen.'}</p>`;
      if(duplicate)detail+='<p class="rota-relation rota-attention">More than one cover is set for this person. Check the plan.</p>';
      if(target?.name&&status(target)!=='playing')detail+='<p class="rota-relation rota-attention">This person is not marked Playing. Check the handover.</p>';
    }
    if((person.id==='director:0'&&covering.some(cover=>cover.department==='judges'))||(current==='cover'&&person.department==='judges'&&target?.id==='director:0'))detail+=`<p class="rota-relation rota-attention">${ASSISTANT_COVER_WARNING}</p>`;
    const controls=editable&&person.name?`<div class="rota-choices" role="group" aria-label="${e(person.name)} — round assignment">${Object.entries(STATUS_LABELS).filter(([key])=>key!=='unset').map(([key,label])=>`<button type="button" data-rota-person="${e(person.id)}" data-rota-status="${key}" class="rota-choice ${current===key?'selected':''}" aria-pressed="${current===key}" aria-label="${e(person.name)} — ${label}">${label}</button>`).join('')}</div>`:`<div class="rota-readonly-status"><span class="rota-status ${person.name||assignment?current:'unset'}">${person.name||assignment?STATUS_LABELS[current]:'Add a name to assign'}</span>${editable&&!person.name&&assignment?`<button class="text-button" data-rota-person="${e(person.id)}" data-rota-status="${current}" aria-pressed="true" aria-label="Clear ${e(person.role)} assignment">Clear</button>`:''}</div>`;
    return `<li class="rota-person${person.name?'':' unnamed'}" data-rota-row="${e(person.id)}"><div class="rota-person-top"><div class="rota-person-name"><strong>${e(person.name||'TBA')}</strong><small>${e(person.role)}${person.optional?' · optional':''}</small></div>${controls}</div>${detail}</li>`;
  };
  const groups=DEPARTMENTS.map(department=>{
    const members=people.filter(person=>person.department===department.id&&(filter==='all'||(!person.name&&assignments[person.id])||(filter==='unset'?!person.name||status(person)==='unset':person.name&&status(person)===filter)));
    return members.length?`<section class="rota-department"><h3>${e(department.name)}</h3><ul>${members.map(row).join('')}</ul></section>`:'';
  }).join('');

  return `<section class="committee-rotation" aria-label="Round assignments">
    <header class="rota-header"><p>${hint}</p><div class="rota-header-actions">${editable?'<button class="secondary" data-open="rotation-plan">Auto-fill rota</button>':''}<button class="text-button" data-open="committee">${editable?'Edit committee names':'Committee names'} <span aria-hidden="true">↗</span></button></div></header>
    <nav class="rota-games" aria-label="Rotation game">${ROTATION_GAMES.map(item=>`<button type="button" data-rota-game="${item.id}" class="${game===item.id?'selected':''}" aria-pressed="${game===item.id}">${e(item.label)}</button>`).join('')}</nav>
    ${basketTeams}
    <nav class="rota-rounds" aria-label="Rotation round">${rounds.map(item=>`<button type="button" data-rota-round="${item.key}" class="${roundKey===item.key?'selected':''}" aria-pressed="${roundKey===item.key}">${e(item.label)}</button>`).join('')}</nav>
    <div class="rota-overview"><p>${named.length} named ${named.length===1?'person':'people'} · counts exclude TBA</p><nav class="rota-filters" aria-label="Filter committee assignments"><button type="button" data-rota-filter="all" aria-pressed="${filter==='all'}" class="${filter==='all'?'selected':''}">All <b>${named.length}</b></button>${Object.entries(STATUS_LABELS).map(([key,label])=>`<button type="button" data-rota-filter="${key}" aria-pressed="${filter===key}" class="${filter===key?'selected':''}">${label} <b>${counts[key]}</b></button>`).join('')}</nav></div>
    ${uncovered.length?`<p class="rota-coverage-note">${uncovered.length} playing ${uncovered.length===1?'person has':'people have'} no named cover. Check their duties before the round.</p>`:''}
    ${unnamedAssigned.length?`<p class="rota-coverage-note">${unnamedAssigned.length} assigned ${unnamedAssigned.length===1?'slot needs':'slots need'} names. Saved assignments are shown below as TBA.</p>`:''}
    ${named.length<people.length?`<p class="rota-name-hint">Add names in Committee before assigning TBA slots.</p>`:''}
    <div class="rota-departments">${groups||'<p class="rota-empty">No named people in this group.</p>'}</div>
    <aside class="rota-safety"><h3>Before swapping</h3><ul><li>Hand over between rounds. Confirm the cover is ready before leaving.</li><li>First aid needs trained relief and a CPR-capable person on duty. Keep both first-aid positions covered.</li><li>The main judge needs an appointed neutral replacement. The assistant still watches and confirms.</li></ul></aside>
    ${editable?`<div class="rota-actions">${previous?`<button class="secondary" data-action="copy-committee-round" data-rota-round-key="${roundKey}" data-rota-previous="${previous.key}" ${Object.keys(state.committeeRotation?.[previous.key]||{}).length?'':'disabled'}>Copy previous round</button>`:''}<button class="text-button" data-action="reset-committee-round" data-rota-round-key="${roundKey}" ${hasAssignments?'':'disabled'}>Clear this round</button></div>`:''}
  </section>`;
}
