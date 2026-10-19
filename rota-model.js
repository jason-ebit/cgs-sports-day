// Stable slot IDs keep the rota attached to committee members when names change.
export const COMMITTEE_SLOT_COUNTS = Object.freeze({director:1,judges:1,'first-aid':2,equipment:3,'food-water':3,comms:2,'team-leaders':5,warmup:1});
export const COMMITTEE_PERSON_IDS = Object.freeze(Object.entries(COMMITTEE_SLOT_COUNTS).flatMap(([department,count])=>
  Array.from({length:count},(_,slot)=>`${department}:${slot}`)));
export const ROTATION_ROUND_KEYS = Object.freeze([
  ...Array.from({length:7},(_,round)=>`borrow:${round}`),
  ...['red','blue','yellow','green','white'].flatMap(team=>[0,1].map(attempt=>`basket:${team}:${attempt}`)),
  'cavalry:women','cavalry:men',
  'tug:prelim','tug:semi1','tug:semi2','tug:final',
  'relay:0','relay:1','relay:2',
]);
export const ROTATION_STATUSES = Object.freeze(['playing','duty','cover']);

export function validateCommitteeRotation(value) {
  const fail=()=>{throw Error('The committee rotation is not valid.');};
  const object=input=>{if(!input||typeof input!=='object'||Array.isArray(input))fail();return input;};
  object(value);
  if(Object.keys(value).some(round=>!ROTATION_ROUND_KEYS.includes(round)))fail();
  const rotation={};
  // Rebuild in a fixed order so JSONB key order cannot create a needless save.
  for(const round of ROTATION_ROUND_KEYS){
    if(!Object.hasOwn(value,round))continue;
    const assignments=object(value[round]);
    if(Object.keys(assignments).some(person=>!COMMITTEE_PERSON_IDS.includes(person)))fail();
    rotation[round]={};
    for(const person of COMMITTEE_PERSON_IDS){
      if(!Object.hasOwn(assignments,person))continue;
      const assignment=object(assignments[person]);
      if(Object.keys(assignment).length!==2||!Object.hasOwn(assignment,'status')||!Object.hasOwn(assignment,'coverFor'))fail();
      const {status,coverFor}=assignment;
      if(!ROTATION_STATUSES.includes(status))fail();
      if(coverFor!==null&&(!COMMITTEE_PERSON_IDS.includes(coverFor)||coverFor===person||status!=='cover'))fail();
      rotation[round][person]={status,coverFor};
    }
  }
  return rotation;
}
