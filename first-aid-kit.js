// Photo windows use the original kit photo unchanged, so the labels match the packs.
const KIT_PHOTO = './assets/first-aid/kit-reference.png';

export const FIRST_AID_KIT_ITEMS = Object.freeze([
  {name:'Gauze sheet', korean:'수성거즈-엔', detail:'1 sheet', crop:[42,761,139,183]},
  {name:'Cotton wool', korean:'수성탈지면', detail:'10 g', crop:[209,751,132,195]},
  {name:'Thin wound patches', korean:'메디덤슬림', detail:'72 small + 24 larger', crop:[393,746,119,212]},
  {name:'Scissors', korean:'가위', detail:'', crop:[544,735,140,231]},
  {name:'Children’s plasters', korean:'키즈밴드', detail:'1 box', crop:[44,1056,126,190]},
  {name:'Cotton buds', korean:'수성면봉', detail:'Check the pack amount', crop:[204,1057,143,195]},
  {name:'Eye patch', korean:'서울그린안대', detail:'1 patch', crop:[367,1058,151,190]},
  {name:'Tweezers', korean:'핀셋', detail:'', crop:[546,1053,132,212]},
  {name:'Roll bandage', korean:'수성붕대', detail:'', crop:[43,1349,135,204]},
  {name:'Elastic bandage', korean:'수성탄력붕대 에스', detail:'', crop:[210,1347,136,217]},
  {name:'Adhesive plasters', korean:'메디밴드 살균', detail:'100 plasters', crop:[395,1350,111,217]},
  {name:'Alcohol wipes', korean:'알콜스왑', detail:'10 wipes', crop:[558,1379,119,161]},
  {name:'Medical tape', korean:'메디 면반창고', detail:'', crop:[33,1694,147,150]},
  {name:'Sterile gauze pads', korean:'멸균거즈-엔', detail:'5 × 5 cm · 8-ply (8 layers)', crop:[210,1687,138,163]},
  {name:'Small sterile dressings', korean:'네오멸균드레싱 소형', detail:'8 dressings · 70 × 60 mm', crop:[393,1682,118,188]},
  {name:'Cotton pads', korean:'탈지면-엔', detail:'', crop:[553,1700,132,135]},
]);

const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

export function renderFirstAidKit() {
  return `<details class="first-aid-kit">
    <summary><span>First-aid kit · ${FIRST_AID_KIT_ITEMS.length} items</span><span class="first-aid-kit-chevron" aria-hidden="true"></span></summary>
    <div class="first-aid-kit-body">
      <p class="first-aid-kit-intro">Match the English name to the photo. Check the actual pack for amounts and expiry dates.</p>
      <ol class="first-aid-kit-grid">${FIRST_AID_KIT_ITEMS.map((item,index) => `<li class="first-aid-kit-item"><figure>
        <svg class="first-aid-kit-photo" viewBox="${item.crop.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHTML(item.name)} — photo from the kit list" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="first-aid-kit-clip-${index}" clipPathUnits="userSpaceOnUse"><rect x="${item.crop[0]}" y="${item.crop[1]}" width="${item.crop[2]}" height="${item.crop[3]}"/></clipPath></defs><image href="${KIT_PHOTO}" width="729" height="2048" clip-path="url(#first-aid-kit-clip-${index})"/></svg>
        <figcaption><span class="first-aid-kit-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><strong>${escapeHTML(item.name)}</strong><span class="first-aid-kit-korean" lang="ko">${escapeHTML(item.korean)}</span>${item.detail?`<small>${escapeHTML(item.detail)}</small>`:''}</figcaption>
      </figure></li>`).join('')}</ol>
      <a class="first-aid-kit-source" href="${KIT_PHOTO}" target="_blank" rel="noopener">View full kit photo ↗</a>
    </div>
  </details>`;
}
