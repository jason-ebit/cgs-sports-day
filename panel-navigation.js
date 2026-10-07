// Each panel keeps its own return view; ordinary tab changes do not add a step.
export function createPanelNavigation(limit=12) {
  const stack=[];
  return {
    enter(previous,nextKey){
      if(previous?.key&&previous.key!==nextKey){
        stack.push(previous);
        if(stack.length>limit)stack.shift();
      }
    },
    get previous(){return stack.at(-1)||null;},
    back(){return stack.pop()||null;},
    clear(){stack.length=0;},
  };
}

// Text-based keys keep checked items attached to their task if notes are reordered.
export function checklistKey(scope,text) {
  let hash=2166136261;
  for(const character of text)hash=Math.imul(hash^character.codePointAt(0),16777619);
  return `${scope}:${(hash>>>0).toString(36)}`;
}
